import { mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../core/config.js';
import { writeJsonAtomic } from '../core/state.js';
import type { DataStatus, SliWeb } from '../sli/engine.js';

/**
 * The web check figures of the months that have closed, as they were when first read after the month closed (ADR 0016, BK-60): the readings behind
 * them age out of Zabbix. A file of its own in PORTAL_STATE_DIR; with no folder nothing is kept, since figures in memory would not outlive a restart.
 */

export interface KeptWeb {
  /** Unix seconds. */
  takenAt: number;
  web: SliWeb[];
}

export interface ClosedWebStore {
  /** False for a store in memory alone: figures it kept would be lost at the next start, so none are kept. */
  readonly durable: boolean;
  /** A copy of what is kept for the month, or null. */
  get(month: string): KeptWeb | null;
  /** Keeps the figures of a month that has none, and says so; false when it has some. Rejects, keeping nothing, when the file cannot be written. */
  keep(month: string, kept: KeptWeb): Promise<boolean>;
}

/** Three years: far more than the year of events Zabbix holds, and a few kilobytes of file. */
export const MAX_MONTHS_KEPT = 36;
const FILE_NAME = 'closed-months.json';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const STATUSES: readonly unknown[] = ['ok', 'partial', 'nodata'] satisfies DataStatus[];

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const within = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function checkOf(v: unknown): SliWeb | null {
  if (!isObject(v)) return null;
  const { itemid, name, sli, downtime, coverage, dataStatus } = v;
  if (typeof itemid !== 'string' || itemid === '' || typeof name !== 'string') return null;
  if (sli !== null && !within(sli, 0, 100)) return null;
  if (!within(downtime, 0, Number.MAX_SAFE_INTEGER) || !within(coverage, 0, 1) || !STATUSES.includes(dataStatus)) return null;
  return { itemid, name, sli, downtime, coverage, dataStatus: dataStatus as DataStatus };
}

function keptOf(v: unknown): KeptWeb | null {
  if (!isObject(v) || !within(v.takenAt, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(v.web)) return null;
  const web = v.web.map(checkOf);
  return web.every((c) => c !== null) ? { takenAt: v.takenAt, web: web as SliWeb[] } : null;
}

/** What a file holds: the months that read well, a line for each that did not, and whether the file is of a kind this build reads at all. */
export function readClosedWeb(raw: unknown): { months: Record<string, KeptWeb>; repairs: string[]; usable: boolean } {
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.months)) return { months: {}, repairs: [], usable: false };
  const months: Record<string, KeptWeb> = {};
  const repairs: string[] = [];
  for (const [key, value] of Object.entries(raw.months)) {
    const kept = MONTH.test(key) ? keptOf(value) : null;
    if (kept) months[key] = kept;
    else repairs.push(`The web check figures kept for ${key} could not be read and were dropped.`);
  }
  const newest = Object.keys(months).sort().reverse();
  if (newest.length > MAX_MONTHS_KEPT) {
    for (const key of newest.slice(MAX_MONTHS_KEPT)) delete months[key];
    repairs.push(`The file held more than ${MAX_MONTHS_KEPT} months of web check figures; the oldest were dropped.`);
  }
  return { months, repairs, usable: true };
}

const copy = (kept: KeptWeb): KeptWeb => structuredClone(kept);

/** What a portal with no data folder runs on, and what the tests start from: it keeps nothing, and says it is not durable. */
export const memoryClosedWeb = (): ClosedWebStore => ({ durable: false, get: () => null, keep: async () => false });

function durableStore(initial: Record<string, KeptWeb>, file: string): ClosedWebStore {
  let months = initial;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    durable: true,
    get: (month) => (months[month] ? copy(months[month]) : null),
    keep(month, kept) {
      const run = async (): Promise<boolean> => {
        if (months[month]) return false;
        const next = { ...months, [month]: copy(kept) };
        for (const key of Object.keys(next).sort().reverse().slice(MAX_MONTHS_KEPT)) delete next[key];
        await writeJsonAtomic(file, { version: 1, months: next });
        months = next;
        return months[month] !== undefined;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

/**
 * Opens the file in `dir`, or a store in memory alone when `dir` is empty or cannot be used. Never throws: a portal that cannot keep these
 * figures still reports. A file it cannot read, or of another version, is put aside and not deleted, and the portal starts empty.
 */
export async function openClosedWeb(dir: string, warn: (message: string) => void): Promise<ClosedWebStore> {
  if (dir === '') return memoryClosedWeb();
  const file = join(dir, FILE_NAME);
  try {
    await mkdir(dir, { recursive: true });
    let text: string | null = null;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    let months: Record<string, KeptWeb> = {};
    if (text !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const read = readClosedWeb(parsed);
      if (!read.usable) {
        await rename(file, `${file}.broken-${Date.now()}`);
        warn(`The portal's file of web check figures (${FILE_NAME}) could not be read and was put aside as ${FILE_NAME}.broken-<time>. It starts empty.`);
      } else {
        months = read.months;
        if (read.repairs.length) {
          for (const line of new Set(read.repairs)) warn(line);
          await writeJsonAtomic(file, { version: 1, months });
        }
      }
    }
    return durableStore(months, file);
  } catch {
    warn('The portal cannot read or write its data folder (PORTAL_STATE_DIR) for the web check figures of closed months, so it will not keep them.');
    return memoryClosedWeb();
  }
}

let current: ClosedWebStore = memoryClosedWeb();

/** The one store, opened at start-up (index.ts) from PORTAL_STATE_DIR. Until then, and in the tests, it keeps nothing. */
export const closedWeb = (): ClosedWebStore => current;

export async function initClosedWeb(warn: (message: string) => void): Promise<ClosedWebStore> {
  current = await openClosedWeb(config.stateDir, warn);
  return current;
}

/** For the tests: put a store of their own in place. */
export function useClosedWeb(store: ClosedWebStore): void {
  current = store;
}
