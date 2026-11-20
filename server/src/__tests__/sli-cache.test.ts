import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ENTRIES, cached, invalidate } from '../core/cache.js';

/**
 * getMonthlySli is the one place the derived SLA is computed and kept, and
 * both /api/sli and /api/sli/export lean on it: the export promises not to
 * compute again what the page has already loaded. computeSli is replaced by a
 * counter, so these tests count computations and nothing else.
 */

const { compute, readData } = vi.hoisted(() => ({ compute: vi.fn(), readData: vi.fn() }));
vi.mock('../sli/engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sli/engine.js')>();
  return { ...actual, computeSli: compute, readSliData: readData };
});

const { getMonthlySli, getMonthData } = await import('../services/sli.js');

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
  readData.mockReset();
  // What a read of a span holds, as small as the cache's weighing needs: no hosts, no events.
  readData.mockImplementation(async (req: { profile: string; from: number; to: number; now: number }) => ({
    profile: req.profile, from: req.from, to: req.to, end: Math.min(req.to, req.now), readAt: req.now * 1000, hosts: [], initial: new Map(), events: new Map(), maintenance: new Map(),
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0 }, marker: ++made,
  }));
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

  it('keeps a closed month for a day, because it changes rarely', async () => {
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

  it('keeps a closed month, which costs a full recompute and changes rarely', async () => {
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

// BK-102: getMonthData is what a window is made of; it keeps a month under the phases of the monthly report, and its key tells them apart.
describe('getMonthData keeps the data of a span of the month as the monthly report is kept (ADR-0018)', () => {
  it('reads once for every caller of one month and method, even all at once, and a month and a method each on their own', async () => {
    const [a, b] = await Promise.all([getMonthData(CLOSED, 'availability'), getMonthData(CLOSED, 'availability')]);
    expect(a).toBe(b);
    expect(readData).toHaveBeenCalledTimes(1);
    const other = await getMonthData(CLOSED, 'hcml-report');
    const month = await getMonthData('2026-07', 'availability');
    expect(readData).toHaveBeenCalledTimes(3);
    expect(new Set([a, other, month]).size).toBe(3);
  });

  it('keeps a closed month for a day, and does not keep the reading of the monthly report for it (the two keys are apart)', async () => {
    const first = await getMonthData(CLOSED, 'availability');
    later(23 * HOUR);
    expect(await getMonthData(CLOSED, 'availability')).toBe(first);
    expect(readData).toHaveBeenCalledTimes(1);
    await getMonthlySli(CLOSED, 'availability');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('keeps a month still running for five minutes, and then reads it again behind the answer', async () => {
    const first = await getMonthData(OPEN, 'availability');
    later(4 * MINUTE);
    expect(await getMonthData(OPEN, 'availability')).toBe(first);
    expect(readData).toHaveBeenCalledTimes(1);
    later(6 * MINUTE);
    expect(await getMonthData(OPEN, 'availability')).toBe(first);
    await settle();
    expect(readData).toHaveBeenCalledTimes(2);
    expect(await getMonthData(OPEN, 'availability')).not.toBe(first);
  });

  it('does not keep what was read in the first ten minutes after a month ends as its final data: the settling phase has a key of its own', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:00:30Z'));
    const early = await getMonthData(OPEN, 'availability');
    // Three minutes on, still the settling phase, kept for a few minutes.
    vi.setSystemTime(new Date('2026-10-31T17:03:00Z'));
    expect(await getMonthData(OPEN, 'availability')).toBe(early);
    expect(readData).toHaveBeenCalledTimes(1);
    // Past the ten minutes it is read again as the final data, and kept for a day.
    vi.setSystemTime(new Date('2026-10-31T17:10:01Z'));
    const settled = await getMonthData(OPEN, 'availability');
    expect(settled).not.toBe(early);
    expect(readData).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-11-01T16:00:00Z'));
    expect(await getMonthData(OPEN, 'availability')).toBe(settled);
    expect(readData).toHaveBeenCalledTimes(2);
  });

  it('does not keep a month as its final data once it has closed, though the open data is well inside the window', async () => {
    vi.setSystemTime(new Date('2026-10-31T16:58:00Z'));
    const whileOpen = await getMonthData(OPEN, 'availability');
    vi.setSystemTime(new Date('2026-10-31T17:01:00Z'));
    expect(await getMonthData(OPEN, 'availability')).not.toBe(whileOpen);
    expect(readData).toHaveBeenCalledTimes(2);
  });

  it('is asked to read the span of the month it names, in the hour it is asked, and refuses a month that began before Zabbix keeps events', async () => {
    await getMonthData(CLOSED, 'availability');
    const asked = readData.mock.calls[0][0] as { profile: string; from: number; to: number; now: number };
    expect(asked.profile).toBe('availability');
    expect(new Date(asked.from * 1000).toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(new Date(asked.to * 1000).toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(asked.now).toBe(Math.floor(NOW.getTime() / 1000));
    // Refused before a place in the line is asked for, so it throws and does not return a promise.
    expect(() => getMonthData('2024-01', 'availability')).toThrow(/about a year/);
    expect(readData).toHaveBeenCalledTimes(1);
  });

  it('answers with the last data when a read fails after the cache has aged, rather than with the error', async () => {
    const first = await getMonthData(OPEN, 'availability');
    later(11 * MINUTE);
    readData.mockRejectedValue(new Error('Zabbix is struggling'));
    expect(await getMonthData(OPEN, 'availability')).toBe(first);
  });

  it('can be asked for data no older than a given age, which reads the month again, as the window of a range that begins after the data does', async () => {
    const first = await getMonthData(OPEN, 'availability');
    later(2 * MINUTE);
    const fresher = await getMonthData(OPEN, 'availability', undefined, 60_000);
    expect(fresher).not.toBe(first);
    expect(readData).toHaveBeenCalledTimes(2);
  });
});

