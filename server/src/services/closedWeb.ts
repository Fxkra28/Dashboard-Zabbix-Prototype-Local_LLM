import type { SliReport } from '../sli/engine.js';
import { SETTLE_SECONDS } from '../sli/schedule.js';
import { monthBounds, monthOf, previousMonth } from '../sli/time.js';
import { closedWeb, type ClosedWebStore } from './closedWebStore.js';

/**
 * The web check figures of a closed month stay as they were when it was first read after it closed (ADR 0016, BK-60), and the page and the reports say when.
 * Only the strict method has web checks, and only these figures are kept: the hosts' own move when a maintenance period is corrected.
 */

interface LineLog {
  info(line: object, message: string): void;
  warn(line: object, message: string): void;
}

let log: LineLog | null = null;

/** Where the failures of this module are written (index.ts); until then they are not. */
export function setClosedWebLogger(next: LineLog | null): void {
  log = next;
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const withKept = (report: SliReport, kept: { takenAt: number; web: SliReport['web'] }): SliReport => ({ ...report, web: kept.web, webTakenAt: kept.takenAt });

/** The report of a closed month with its web check figures as kept: the first read keeps them, a later one gives them back. A portal that cannot keep them gives the report as it came. */
export async function freezeWeb(report: SliReport): Promise<SliReport> {
  const store = closedWeb();
  const month = report.month;
  if (!month || report.profile !== 'availability') return report;
  const kept = store.get(month);
  if (kept) return withKept(report, kept);
  // The moment the engine read them, which is what the figures are as of.
  const takenAt = report.generatedAt;
  try {
    if (await store.keep(month, { takenAt, web: report.web })) return { ...report, webTakenAt: takenAt };
  } catch (err) {
    log?.warn({ month, reason: reasonOf(err) }, 'closed month: could not keep the web check figures; this report shows them as read now');
    return report;
  }
  // Another reader kept them first.
  const other = store.get(month);
  return other ? withKept(report, other) : report;
}

/** The first check soon after start-up, then one every hour. */
const FIRST_TICK_MS = 2 * 60_000;
const TICK_MS = 60 * 60_000;

export interface CaptureDeps {
  /** Unix seconds. */
  now(): number;
  timezone: string;
  store(): ClosedWebStore;
  /** Reads the month as the SLA page does, which keeps its figures; here it is `getMonthlySli(month, 'availability')`. */
  read(month: string): Promise<unknown>;
  log: LineLog;
}

export interface ClosedMonthCapture {
  tick(): Promise<void>;
  start(): void;
  /** Stops the timers, so that no new check starts. */
  pause(): void;
  /** Pauses, then waits for a check that is running. */
  stop(): Promise<void>;
}

/** Reads the month that has just closed once it has settled, so that the figures kept are those of that day and not of whoever opens the page first. A failed read is tried again at the next check. */
export function createClosedMonthCapture(deps: CaptureDeps): ClosedMonthCapture {
  let ticker: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;

  async function check(): Promise<void> {
    const store = deps.store();
    if (!store.durable) return;
    const month = previousMonth(monthOf(deps.now(), deps.timezone));
    if (deps.now() < monthBounds(month, deps.timezone).to + SETTLE_SECONDS || store.get(month)) return;
    try {
      await deps.read(month);
      const kept = store.get(month);
      if (kept) deps.log.info({ month, takenAt: kept.takenAt }, 'closed month: web check figures kept');
    } catch (err) {
      deps.log.warn({ month, reason: reasonOf(err) }, 'closed month: could not read it to keep its web check figures; will try again');
    }
  }

  const tick = (): Promise<void> => (running ??= check().finally(() => (running = null)));

  const pause = (): void => {
    if (ticker) clearInterval(ticker);
    if (first) clearTimeout(first);
    ticker = first = undefined;
  };

  return {
    tick,
    start() {
      if (ticker) return;
      ticker = setInterval(() => void tick(), TICK_MS);
      ticker.unref();
      first = setTimeout(() => void tick(), FIRST_TICK_MS);
      first.unref();
    },
    pause,
    async stop() {
      pause();
      await running;
    },
  };
}
