import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The web check figures of a closed month stay as they were when the month was first read after it closed (ADR 0016, BK-60), and the
 * month that has just closed is read soon after it does, so that the figures kept are the ones of the day it closed.
 */

const { compute } = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock('../sli/engine.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../sli/engine.js')>()), computeSli: compute }));

const { getMonthlySli } = await import('../services/sli.js');
const { createClosedMonthCapture, freezeWeb, setClosedWebLogger } = await import('../services/closedWeb.js');
const { memoryClosedWeb, openClosedWeb, useClosedWeb } = await import('../services/closedWebStore.js');
const { invalidate } = await import('../core/cache.js');

const check = (n: number, sli: number | null, over: Record<string, unknown> = {}) => ({ itemid: `${n}`, name: `Scenario ${n}`, sli, downtime: 60, coverage: 1, dataStatus: sli === null ? 'nodata' : 'ok', ...over });
const AS_CLOSED = [check(1, 99.9), check(2, 98.5)];
const AFTER_AGING = [check(1, 99.9, { coverage: 0.9 }), check(2, null)];
const HOSTS_THEN = { sli: 99.1 };
const HOSTS_NOW = { sli: 99.4 };

const NOW = new Date('2026-11-02T01:00:00Z'); // 08:00 on 2 November in Jakarta: October has closed
let dir: string;
const warnings: string[] = [];
const log = { warn: (_line: object, message: string) => warnings.push(message), info: vi.fn() };

/** What the engine says for a month, in the shape the service reads. */
const report = (month: string, profile: string, web: unknown, extra: Record<string, unknown> = {}) => ({ month, profile, closed: true, web, overall: HOSTS_THEN, generatedAt: Math.floor(NOW.getTime() / 1000) - 7, ...extra });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  invalidate('');
  compute.mockReset();
  warnings.length = 0;
  setClosedWebLogger(log);
  dir = await mkdtemp(join(tmpdir(), 'hcml-freeze-'));
  useClosedWeb(await openClosedWeb(dir, (m) => warnings.push(m)));
});
afterEach(async () => {
  vi.useRealTimers();
  useClosedWeb(memoryClosedWeb());
  await rm(dir, { recursive: true, force: true });
});

/** The engine read the figures a few seconds before the call came back: that is when they are as of. */
const takenNow = Math.floor(NOW.getTime() / 1000) - 7;

describe('a closed month keeps its web check figures', () => {
  it('keeps the figures it reads first, and gives them again when the engine says something else', async () => {
    compute.mockResolvedValue(report('2026-10', 'availability', AS_CLOSED));
    const first = await getMonthlySli('2026-10', 'availability');
    expect(first.web).toEqual(AS_CLOSED);
    expect(first.webTakenAt).toBe(takenNow);

    // The next day's read: the readings have aged and the hosts moved by a maintenance correction.
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 86_400_000));
    invalidate('');
    compute.mockResolvedValue(report('2026-10', 'availability', AFTER_AGING, { overall: HOSTS_NOW }));
    const later = await getMonthlySli('2026-10', 'availability');
    expect(later.web).toEqual(AS_CLOSED);
    expect(later.webTakenAt).toBe(takenNow);
    // what is not a web figure is the engine's own, as it reads now
    expect(later.overall).toEqual(HOSTS_NOW);
  });

  it('does not ask the store to keep a month it already holds', async () => {
    const store = await openClosedWeb(dir, () => undefined);
    useClosedWeb(store);
    const keep = vi.spyOn(store, 'keep');
    compute.mockResolvedValue(report('2026-10', 'availability', AS_CLOSED));
    await getMonthlySli('2026-10', 'availability');
    invalidate('');
    await getMonthlySli('2026-10', 'availability');
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('gives the same figures to a portal that has restarted, from the file', async () => {
    compute.mockResolvedValue(report('2026-10', 'availability', AS_CLOSED));
    await getMonthlySli('2026-10', 'availability');

    useClosedWeb(await openClosedWeb(dir, (m) => warnings.push(m)));
    invalidate('');
    compute.mockResolvedValue(report('2026-10', 'availability', AFTER_AGING));
    const again = await getMonthlySli('2026-10', 'availability');
    expect(again.web).toEqual(AS_CLOSED);
    expect(again.webTakenAt).toBe(takenNow);
  });

  it('keeps each month on its own', async () => {
    compute.mockImplementation(async (req: { month: string; profile: string }) => report(req.month, req.profile, req.month === '2026-10' ? AS_CLOSED : AFTER_AGING));
    const october = await getMonthlySli('2026-10', 'availability');
    const september = await getMonthlySli('2026-09', 'availability');
    expect(october.web).toEqual(AS_CLOSED);
    expect(september.web).toEqual(AFTER_AGING);
    expect(september.webTakenAt).toBe(takenNow);
  });

  it('keeps a month that had no web checks as having none', async () => {
    compute.mockResolvedValue(report('2026-10', 'availability', []));
    const first = await getMonthlySli('2026-10', 'availability');
    expect(first.webTakenAt).toBe(takenNow);
    invalidate('');
    compute.mockResolvedValue(report('2026-10', 'availability', AFTER_AGING));
    expect((await getMonthlySli('2026-10', 'availability')).web).toEqual([]);
  });

  it('leaves HCML\'s method alone: it measures no web checks, and keeps nothing', async () => {
    compute.mockResolvedValue(report('2026-10', 'hcml-report', []));
    const hcml = await getMonthlySli('2026-10', 'hcml-report');
    expect(hcml.webTakenAt).toBeUndefined();
    compute.mockResolvedValue(report('2026-10', 'availability', AS_CLOSED));
    expect((await getMonthlySli('2026-10', 'availability')).webTakenAt).toBe(takenNow);
  });

  it('keeps nothing for a month that is running or has only just ended', async () => {
    compute.mockImplementation(async (req: { month: string; profile: string }) => report(req.month, req.profile, AS_CLOSED, { closed: false }));
    expect((await getMonthlySli('2026-11', 'availability')).webTakenAt).toBeUndefined();
    // five minutes after the end of October: settling, not closed
    vi.setSystemTime(new Date('2026-10-31T17:05:00Z'));
    invalidate('');
    expect((await getMonthlySli('2026-10', 'availability')).webTakenAt).toBeUndefined();
    // and so nothing is in the way once it has closed
    vi.setSystemTime(NOW);
    invalidate('');
    compute.mockImplementation(async (req: { month: string; profile: string }) => report(req.month, req.profile, AFTER_AGING));
    expect((await getMonthlySli('2026-10', 'availability')).web).toEqual(AFTER_AGING);
  });

  it('keeps nothing, and changes nothing, when the portal has no folder of its own to keep it in', async () => {
    useClosedWeb(memoryClosedWeb());
    compute.mockResolvedValue(report('2026-10', 'availability', AS_CLOSED));
    const first = await getMonthlySli('2026-10', 'availability');
    expect(first.webTakenAt).toBeUndefined();
    invalidate('');
    compute.mockResolvedValue(report('2026-10', 'availability', AFTER_AGING));
    expect((await getMonthlySli('2026-10', 'availability')).web).toEqual(AFTER_AGING);
  });

  it('answers with what it read, says so in the log, and tries again next time, when the file cannot be written', async () => {
    const { chmod } = await import('node:fs/promises');
    compute.mockResolvedValue(report('2026-10', 'availability', AS_CLOSED));
    await chmod(dir, 0o500);
    const blocked = await getMonthlySli('2026-10', 'availability');
    expect(blocked.web).toEqual(AS_CLOSED);
    expect(blocked.webTakenAt).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/could not keep the web check figures/);

    await chmod(dir, 0o700);
    invalidate('');
    expect((await getMonthlySli('2026-10', 'availability')).webTakenAt).toBe(takenNow);
  });

  it('gives two readers who ask at once the same figures and the same time', async () => {
    compute.mockResolvedValueOnce(report('2026-10', 'availability', AS_CLOSED)).mockResolvedValueOnce(report('2026-10', 'availability', AFTER_AGING));
    const [a, b] = await Promise.all([freezeWeb(report('2026-10', 'availability', AS_CLOSED) as never), freezeWeb(report('2026-10', 'availability', AFTER_AGING) as never)]);
    expect(b.web).toEqual(a.web);
    expect(b.webTakenAt).toBe(a.webTakenAt);
    expect(a.web).toEqual(AS_CLOSED);
  });

  it('does not touch a report that is for no calendar month', async () => {
    const rolling = report('2026-10', 'availability', AS_CLOSED, { month: null });
    expect(await freezeWeb(rolling as never)).toBe(rolling);
  });
});

describe('the month that has just closed is read soon after it closes', () => {
  const log2 = { info: vi.fn(), warn: vi.fn() };
  let storeNow: import('../services/closedWebStore.js').ClosedWebStore;
  const makeCapture = (now: Date, how: (month: string) => Promise<unknown> = async () => undefined) => {
    const read = vi.fn<(month: string) => Promise<unknown>>(how);
    return { read, capture: createClosedMonthCapture({ now: () => Math.floor(now.getTime() / 1000), timezone: 'Asia/Jakarta', store: () => storeNow, read, log: log2 }) };
  };
  beforeEach(async () => {
    log2.info.mockReset();
    log2.warn.mockReset();
    storeNow = await openClosedWeb(dir, () => undefined);
  });

  it('reads last month with HCML\'s strict method once, when it has closed and settled, and not again once it is kept', async () => {
    const { read, capture } = makeCapture(new Date('2026-11-01T01:00:00Z'), async (month) => {
      await storeNow.keep(month, { takenAt: 1, web: [] });
    });
    await capture.tick();
    await capture.tick();
    expect(read.mock.calls).toEqual([['2026-10']]);
    expect(log2.info).toHaveBeenCalledTimes(1);
  });

  it('waits until the month has settled, as the monthly send does', async () => {
    const early = makeCapture(new Date('2026-10-31T17:05:00Z'));
    await early.capture.tick();
    expect(early.read).not.toHaveBeenCalled();
    const settled = makeCapture(new Date('2026-10-31T17:11:00Z'));
    await settled.capture.tick();
    expect(settled.read).toHaveBeenCalledWith('2026-10');
  });

  it('takes the month before the one running in the portal\'s zone, not in UTC', async () => {
    // 23:30 on 31 October in Jakarta is 16:30 UTC: October is still running there, so September is the one just closed
    const { read, capture } = makeCapture(new Date('2026-10-31T16:30:00Z'));
    await capture.tick();
    expect(read.mock.calls).toEqual([['2026-09']]);
  });

  it('does nothing when the portal keeps nothing', async () => {
    storeNow = memoryClosedWeb();
    const { read, capture } = makeCapture(new Date('2026-11-01T01:00:00Z'));
    await capture.tick();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not start a second read while one is running', async () => {
    let finish: () => void = () => undefined;
    const { read, capture } = makeCapture(new Date('2026-11-01T01:00:00Z'), () => new Promise<void>((resolve) => (finish = resolve)));
    const a = capture.tick();
    const b = capture.tick();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([a, b]);
  });

  it('says so and tries again at the next check when the read fails, and never throws', async () => {
    const { read, capture } = makeCapture(new Date('2026-11-01T01:00:00Z'), async () => {
      throw new Error('Zabbix did not answer');
    });
    await expect(capture.tick()).resolves.toBeUndefined();
    expect(log2.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log2.warn.mock.calls[0])).toMatch(/Zabbix did not answer/);
    await capture.tick();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('checks on its own once an hour while it runs, and stops when it is told to', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T01:00:00Z'));
    const { read, capture } = makeCapture(new Date('2026-11-01T01:00:00Z'));
    capture.start();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(read).toHaveBeenCalledTimes(2);
    await capture.stop();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
