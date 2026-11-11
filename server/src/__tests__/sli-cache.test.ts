import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ENTRIES, cached, invalidate } from '../core/cache.js';

/**
 * getMonthlySli is the one place the derived SLA is computed and kept, and
 * both /api/sli and /api/sli/export lean on it: the export promises not to
 * compute again what the page has already loaded. computeSli is replaced by a
 * counter, so these tests count computations and nothing else.
 */

const { compute } = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock('../sli/engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sli/engine.js')>();
  return { ...actual, computeSli: compute };
});

const { getMonthlySli } = await import('../services/sli.js');

const NOW = new Date('2026-10-02T03:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CLOSED = '2026-08';
const OPEN = '2026-10';

let made: number;
const later = (ms: number) => vi.setSystemTime(new Date(NOW.getTime() + ms));
/** Lets a background refresh that was started run to its end. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  invalidate('');
  made = 0;
  compute.mockReset();
  compute.mockImplementation(async (req: { month: string; profile: string }) => ({ marker: `${req.month}/${req.profile}/${++made}` }));
});
afterEach(() => vi.useRealTimers());

describe('getMonthlySli keeps what it computes', () => {
  it('computes once for every caller of one month and method, even all at once', async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => getMonthlySli(CLOSED, 'availability')));
    expect(compute).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(await getMonthlySli(CLOSED, 'availability')).toBe(a);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('keeps each month and each method on its own', async () => {
    const strict = await getMonthlySli(CLOSED, 'availability');
    const report = await getMonthlySli(CLOSED, 'hcml-report');
    const other = await getMonthlySli('2026-07', 'availability');
    expect(compute).toHaveBeenCalledTimes(3);
    expect(new Set([strict, report, other]).size).toBe(3);
  });

  it('keeps a closed month for a day, because it cannot change', async () => {
    const first = await getMonthlySli(CLOSED, 'availability');
    later(23 * HOUR);
    expect(await getMonthlySli(CLOSED, 'availability')).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('keeps a month still running for five minutes, and then refreshes it behind the answer', async () => {
    const first = await getMonthlySli(OPEN, 'availability');
    later(4 * MINUTE);
    expect(await getMonthlySli(OPEN, 'availability')).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);

    // Past five minutes the old report still answers at once, and one refresh starts.
    later(6 * MINUTE);
    expect(await getMonthlySli(OPEN, 'availability')).toBe(first);
    await settle();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(await getMonthlySli(OPEN, 'availability')).not.toBe(first);
  });

  it('does not keep a month as its final report once it has closed', async () => {
    // Two minutes before midnight in Jakarta on the last day of October: the month is still open.
    vi.setSystemTime(new Date('2026-10-31T16:58:00Z'));
    const whileOpen = await getMonthlySli(OPEN, 'availability');
    // Three minutes later it has closed, though the open report is still well inside any cache window.
    // Only the key tells the two apart: kept under one key, the snapshot would stand for a day as the final figure.
    vi.setSystemTime(new Date('2026-10-31T17:01:00Z'));
    const closed = await getMonthlySli(OPEN, 'availability');
    expect(closed).not.toBe(whileOpen);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('does not keep what was read in the first ten minutes after a month ends as its final report (BK-44)', async () => {
    // Zabbix still gets the last values of the month for a few minutes: the monthly send waits ten minutes for them.
    vi.setSystemTime(new Date('2026-10-31T17:00:30Z'));
    const early = await getMonthlySli(OPEN, 'availability');
    vi.setSystemTime(new Date('2026-10-31T17:10:01Z'));
    const settled = await getMonthlySli(OPEN, 'availability');
    expect(settled).not.toBe(early);
    expect(compute).toHaveBeenCalledTimes(2);
    // From then on it is final: kept for a day.
    vi.setSystemTime(new Date('2026-11-01T16:00:00Z'));
    expect(await getMonthlySli(OPEN, 'availability')).toBe(settled);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('keeps what was read just after a month ends only for a few minutes (BK-44)', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:00:30Z'));
    const early = await getMonthlySli(OPEN, 'availability');
    vi.setSystemTime(new Date('2026-10-31T17:03:00Z'));
    expect(await getMonthlySli(OPEN, 'availability')).toBe(early);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('answers with the last report when a refresh fails, rather than with the error', async () => {
    const first = await getMonthlySli(OPEN, 'availability');
    // Past the five minutes and the five of stale answers: the next call must fetch in front of the caller.
    later(11 * MINUTE);
    compute.mockRejectedValue(new Error('Zabbix is struggling'));
    expect(await getMonthlySli(OPEN, 'availability')).toBe(first);
  });
});

describe('getMonthlySli under a flood of other keys (BK-13)', () => {
  /** What browsing graphs with explicit dates does: a new key for every look. */
  const flood = async () => {
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await cached(`graph:flood:${i}`, 60_000, async () => i);
  };

  it('keeps a closed month, which costs a full recompute and cannot change', async () => {
    const first = await getMonthlySli(CLOSED, 'availability');
    await flood();
    expect(await getMonthlySli(CLOSED, 'availability')).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('does not pin a month still running, which is replaced every few minutes anyway', async () => {
    await getMonthlySli(OPEN, 'availability');
    await flood();
    await getMonthlySli(OPEN, 'availability');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
