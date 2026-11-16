import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../core/state.js';
import { MAX_MONTHS_KEPT, memoryClosedWeb, openClosedWeb, readClosedWeb, type KeptWeb } from '../services/closedWebStore.js';

/**
 * The web check figures of a closed month, kept in a file of their own beside the portal's state (ADR 0016, BK-60). The file is read
 * with the same care as the state: whatever is wrong with it, the portal starts, says so, and keeps nothing it cannot trust.
 */

const check = (n: number, over: Record<string, unknown> = {}) => ({ itemid: `${n}`, name: `Scenario ${n}`, sli: 99.5, downtime: 120, coverage: 1, dataStatus: 'ok', ...over });
const kept = (takenAt = 1_794_700_000, checks = [check(1), check(2, { sli: null, dataStatus: 'nodata' })]): KeptWeb => ({ takenAt, web: checks as KeptWeb['web'] });
const file = (months: Record<string, unknown>, version: unknown = 1) => ({ version, months });

describe('readClosedWeb', () => {
  it('reads a whole file as it is', () => {
    const read = readClosedWeb(file({ '2026-10': kept(), '2026-09': kept(5) }));
    expect(read.usable).toBe(true);
    expect(read.repairs).toEqual([]);
    expect(read.months['2026-10']).toEqual(kept());
    expect(Object.keys(read.months).sort()).toEqual(['2026-09', '2026-10']);
  });

  it('cannot use what is not an object of version 1 with a table of months', () => {
    for (const raw of [undefined, null, 'text', 7, [], file({}, 2), file({}, '1'), { version: 1 }, { version: 1, months: [] }, { version: 1, months: 'x' }]) {
      expect(readClosedWeb(raw).usable, JSON.stringify(raw)).toBe(false);
    }
  });

  it('drops one month that is wrong and keeps the others, saying which', () => {
    const bad: Record<string, unknown> = {
      '2026-13': kept(),
      'October': kept(),
      '2026-08': { takenAt: -1, web: [] },
      '2026-07': { takenAt: 'x', web: [] },
      '2026-06': { takenAt: 1, web: 'none' },
      '2026-05': { takenAt: 1, web: [check(1, { sli: 100.5 })] },
      '2026-04': { takenAt: 1, web: [check(1, { sli: '99' })] },
      '2026-03': { takenAt: 1, web: [check(1, { dataStatus: 'fine' })] },
      '2026-02': { takenAt: 1, web: [check(1, { downtime: -5 })] },
      '2026-11': { takenAt: 1, web: [check(1, { coverage: 1.5 })] },
      '2026-01': { takenAt: 1, web: [check(1, { itemid: '' })] },
      '2025-12': { takenAt: 1, web: [{ itemid: '1' }] },
      '2025-11': null,
    };
    const read = readClosedWeb(file({ ...bad, '2026-10': kept() }));
    expect(read.usable).toBe(true);
    expect(Object.keys(read.months)).toEqual(['2026-10']);
    expect(read.repairs.length).toBe(Object.keys(bad).length);
    expect(read.repairs.join(' ')).toMatch(/2026-13/);
  });

  it('accepts a month with no web checks, since a month can have had none', () => {
    expect(readClosedWeb(file({ '2026-10': { takenAt: 1, web: [] } })).months['2026-10']).toEqual({ takenAt: 1, web: [] });
  });

  it('keeps the newest months when there are more than it keeps', () => {
    const months: Record<string, unknown> = {};
    for (let i = 0; i < MAX_MONTHS_KEPT + 4; i++) months[`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`] = kept(i + 1);
    const read = readClosedWeb(file(months));
    const names = Object.keys(read.months).sort();
    expect(names.length).toBe(MAX_MONTHS_KEPT);
    expect(names.at(-1)).toBe(Object.keys(months).sort().at(-1));
    expect(names[0]).toBe(Object.keys(months).sort()[4]);
    expect(read.repairs).toHaveLength(1);
  });
});

describe('writeJsonAtomic', () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'hcml-json-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('leaves the finished file alone in its folder, readable by its owner only', async () => {
    await writeJsonAtomic(join(dir, 'a.json'), { x: 1 });
    expect(await readdir(dir)).toEqual(['a.json']);
    expect(JSON.parse(await readFile(join(dir, 'a.json'), 'utf8'))).toEqual({ x: 1 });
    expect((await stat(join(dir, 'a.json'))).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp file behind when the write fails', async () => {
    await expect(writeJsonAtomic(join(dir, 'missing', 'a.json'), { x: 1 })).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('openClosedWeb', () => {
  let dir: string;
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hcml-closed-'));
    warnings.length = 0;
  });
  afterEach(async () => {
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('is a store in memory alone, and says it keeps nothing, when there is no folder', async () => {
    const store = await openClosedWeb('', warn);
    expect(store.durable).toBe(false);
    expect(store.get('2026-10')).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('is the same, and durable false, for the memory store the tests and a portal without a folder use', async () => {
    const store = memoryClosedWeb();
    expect(store.durable).toBe(false);
    expect(await store.keep('2026-10', kept())).toBe(false);
  });

  it('keeps a month in its file and gives it back after the portal restarts', async () => {
    const first = await openClosedWeb(dir, warn);
    expect(first.durable).toBe(true);
    expect(first.get('2026-10')).toBeNull();
    expect(await first.keep('2026-10', kept())).toBe(true);
    expect(first.get('2026-10')).toEqual(kept());

    expect(JSON.parse(await readFile(join(dir, 'closed-months.json'), 'utf8'))).toEqual(file({ '2026-10': kept() }));
    expect((await stat(join(dir, 'closed-months.json'))).mode & 0o777).toBe(0o600);

    const second = await openClosedWeb(dir, warn);
    expect(second.get('2026-10')).toEqual(kept());
    expect(warnings).toEqual([]);
  });

  it('does not overwrite a month that has figures: what was kept stays', async () => {
    const store = await openClosedWeb(dir, warn);
    expect(await store.keep('2026-10', kept(100))).toBe(true);
    expect(await store.keep('2026-10', kept(200, [check(9)]))).toBe(false);
    expect(store.get('2026-10')).toEqual(kept(100));
    expect(JSON.parse(await readFile(join(dir, 'closed-months.json'), 'utf8')).months['2026-10'].takenAt).toBe(100);
  });

  it('keeps every month of several asked for at once', async () => {
    const store = await openClosedWeb(dir, warn);
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    expect(await Promise.all(months.map((m, i) => store.keep(m, kept(i + 1))))).toEqual(months.map(() => true));
    const again = await openClosedWeb(dir, warn);
    for (const [i, m] of months.entries()) expect(again.get(m)?.takenAt, m).toBe(i + 1);
  });

  it('drops the oldest month when it holds more than it keeps', async () => {
    const store = await openClosedWeb(dir, warn);
    for (let i = 0; i < MAX_MONTHS_KEPT + 2; i++) await store.keep(`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, kept(i + 1));
    expect(store.get('2020-01')).toBeNull();
    expect(store.get('2020-02')).toBeNull();
    expect(store.get('2020-03')).not.toBeNull();
    expect(Object.keys(JSON.parse(await readFile(join(dir, 'closed-months.json'), 'utf8')).months)).toHaveLength(MAX_MONTHS_KEPT);
  });

  it('puts a file it cannot read aside, starts empty and says so', async () => {
    await writeFile(join(dir, 'closed-months.json'), '{not json');
    const store = await openClosedWeb(dir, warn);
    expect(store.durable).toBe(true);
    expect(store.get('2026-10')).toBeNull();
    expect((await readdir(dir)).some((n) => /^closed-months\.json\.broken-\d+$/.test(n))).toBe(true);
    expect(warnings.join(' ')).toMatch(/closed-months\.json/);
    expect(await store.keep('2026-10', kept())).toBe(true);
  });

  it('puts a file of another version aside as well, so that a newer or older build never reads it wrong', async () => {
    await writeFile(join(dir, 'closed-months.json'), JSON.stringify(file({ '2026-10': kept() }, 2)));
    const store = await openClosedWeb(dir, warn);
    expect(store.get('2026-10')).toBeNull();
    expect((await readdir(dir)).some((n) => n.startsWith('closed-months.json.broken-'))).toBe(true);
  });

  it('keeps what is good in a file with a bad month, and rewrites the file without the bad one', async () => {
    await writeFile(join(dir, 'closed-months.json'), JSON.stringify(file({ '2026-10': kept(), '2026-13': kept() })));
    const store = await openClosedWeb(dir, warn);
    expect(store.get('2026-10')).toEqual(kept());
    expect(warnings.join(' ')).toMatch(/2026-13/);
    expect(Object.keys(JSON.parse(await readFile(join(dir, 'closed-months.json'), 'utf8')).months)).toEqual(['2026-10']);
  });

  it('is a store in memory alone, with a warning, when the folder cannot be made', async () => {
    await writeFile(join(dir, 'in-the-way'), 'a file');
    const store = await openClosedWeb(join(dir, 'in-the-way', 'data'), warn);
    expect(store.durable).toBe(false);
    expect(warnings.join(' ')).toMatch(/PORTAL_STATE_DIR/);
  });

  it('does not keep a month in memory when its file cannot be written, so a later try can', async () => {
    const store = await openClosedWeb(dir, warn);
    await chmod(dir, 0o500);
    await expect(store.keep('2026-10', kept())).rejects.toThrow();
    expect(store.get('2026-10')).toBeNull();
    await chmod(dir, 0o700);
    expect(await store.keep('2026-10', kept())).toBe(true);
    expect(store.get('2026-10')).toEqual(kept());
  });

  it('hands out copies, so that a caller cannot change what is kept', async () => {
    const store = await openClosedWeb(dir, warn);
    await store.keep('2026-10', kept());
    const got = store.get('2026-10')!;
    got.web[0].name = 'changed';
    got.takenAt = 1;
    expect(store.get('2026-10')).toEqual(kept());
  });
});

vi.setConfig({ testTimeout: 15_000 });
