/**
 * Lets at most `limit` jobs run at once, the rest waiting first come first served; a job that throws gives its place back. For the slow reports
 * (analytics.ts): a cold one is thousands of SQL statements and the cache answers only a repeated query, so without a limit new `days` and `severity` keep MySQL busy.
 */
export interface Gate {
  run<T>(job: () => Promise<T>, opts?: GateRun): Promise<T>;
  readonly running: number;
  readonly waiting: number;
}

export interface GateRun {
  /** Asked when a job that waited reaches the front. False drops it unread (`Cancelled`) and the next in line gets its place. */
  wanted?: () => boolean;
}

/** A waiting job was dropped because its reader left, so nothing was read for it. */
export class Cancelled extends Error {
  constructor() {
    super('The read was dropped before it started: its reader left.');
    this.name = 'Cancelled';
  }
}

export function createGate(limit: number): Gate {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('A gate needs a whole limit of at least 1.');
  let running = 0;
  const queue: Array<() => void> = [];

  return {
    async run<T>(job: () => Promise<T>, opts?: GateRun): Promise<T> {
      // A place handed to the next in line stays counted in `running`, so a newcomer cannot jump the queue.
      let waited = false;
      if (running < limit) running++;
      else {
        waited = true;
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      try {
        // A job that started at once has a reader by definition; only one that waited can have lost it.
        if (waited && opts?.wanted && !opts.wanted()) throw new Cancelled();
        return await job();
      } finally {
        const next = queue.shift();
        if (next) next();
        else running--;
      }
    },
    get running() {
      return running;
    },
    get waiting() {
      return queue.length;
    },
  };
}
