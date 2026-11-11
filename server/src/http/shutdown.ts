import type { FastifyInstance } from 'fastify';

// Close on SIGTERM and SIGINT: node as PID 1 ignores a signal it has no handler for.
// Its own module, since index.ts starts a server on import and a test could not drive it.

/** Under the 10 s Docker waits before it kills the container. */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

interface SignalSource {
  on(signal: NodeJS.Signals, handler: (signal: NodeJS.Signals) => void): unknown;
  off(signal: NodeJS.Signals, handler: (signal: NodeJS.Signals) => void): unknown;
}

export interface ShutdownOptions {
  timeoutMs?: number;
  /** `process` by default. */
  source?: SignalSource;
  /** `process.exit` by default. */
  exit?: (code: number) => void;
}

/** What the monthly schedule gives a close: stop its timers when the close begins, then wait for a send that is running. */
export interface Closable {
  pause(): void;
  stop(): Promise<void>;
}

/**
 * Fastify drains the requests in flight before it runs the `onClose` hooks, and the limit above counts from the signal. So the
 * schedule is paused when the close begins (`preClose`), and its wait for a running send counts from there.
 */
export function closeWith(app: FastifyInstance, schedule: Closable): void {
  app.addHook('preClose', async () => schedule.pause());
  app.addHook('onClose', async () => schedule.stop());
}

/** Returns the function that takes the handlers off again. */
export function installShutdown(app: FastifyInstance, opts: ShutdownOptions = {}): () => void {
  const { timeoutMs = SHUTDOWN_TIMEOUT_MS, source = process, exit = (code) => process.exit(code) } = opts;
  let closing = false;

  const onSignal = (signal: NodeJS.Signals): void => {
    if (closing) {
      // A second Ctrl-C in a terminal means "now".
      app.log.warn(`${signal} again: exiting without waiting`);
      exit(1);
      return;
    }
    closing = true;
    app.log.info(`${signal} received: closing the BFF`);
    const hard = setTimeout(() => {
      app.log.error(`Closing took longer than ${timeoutMs} ms: exiting anyway`);
      exit(1);
    }, timeoutMs);
    hard.unref?.();
    app.close().then(
      () => {
        clearTimeout(hard);
        app.log.info('BFF closed');
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(hard);
        app.log.error(err);
        exit(1);
      },
    );
  };

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const s of signals) source.on(s, onSignal);
  return () => {
    for (const s of signals) source.off(s, onSignal);
  };
}
