import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withSignal } from '../../api';

interface Snapshot<T> {
  data: T | null;
  error: string | null;
  /** The first load, or a load after `deps` changed, is in flight. Polls and reloads don't set it. */
  loading: boolean;
  /** `data` belongs to the previous `deps`: the new ones are loading, or failed. */
  stale: boolean;
  /** When `data` last arrived (ms since epoch). */
  updatedAt: number | null;
}

interface Run {
  id: number;
  controller: AbortController;
  deps: unknown[];
}

const sameDeps = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Fetch helper with loading/error state and optional polling. `deps` re-runs the fetch;
 * `intervalMs` re-polls on a timer.
 *
 * Only the most recent run may write state: otherwise a slow response for an old selection could
 * overwrite a fast one for the new selection (pick host A, then host B, and host A's items land
 * last and stay on screen).
 *
 * - A run that is replaced (new `deps`, `reload`) or whose component unmounts is aborted; `fn` may
 *   take the signal, and every `api.*` call it makes synchronously gets it anyway (see `withSignal`
 *   in api/client.ts).
 * - Polls are sequential: the next is scheduled only once the last has settled, so a slow BFF is
 *   never asked twice at once. They pause while the tab is hidden and catch up on return when one
 *   came due.
 * - Changing `intervalMs` only moves the timer; it never fetches by itself.
 * - While new `deps` load, the previous data stays with `stale: true`, so a page can dim it rather
 *   than blank it.
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  intervalMs?: number,
) {
  const [snap, setSnap] = useState<Snapshot<T>>({
    data: null,
    error: null,
    loading: true,
    stale: false,
    updatedAt: null,
  });

  // The latest render's fetcher, dependencies and interval, for runs the
  // timer, the tab and `reload` start between renders.
  const latest = useRef({ fn, deps, intervalMs });
  useLayoutEffect(() => {
    latest.current = { fn, deps, intervalMs };
  });

  // Created once per component, so `reload` keeps one identity.
  const [control] = useState(() => {
    let seq = 0;
    let current: Run | null = null;
    let settledAt = 0;
    let timer: number | undefined;
    let dropping: number | undefined;
    let mounted = false;

    const stopTimer = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };

    /** Arm the next poll, counted from when the last run settled. */
    const schedule = () => {
      stopTimer();
      const every = latest.current.intervalMs;
      if (!every || !mounted || current || document.visibilityState === 'hidden') return;
      timer = window.setTimeout(() => start(false), Math.max(0, settledAt + every - Date.now()));
    };

    const start = (depsChanged: boolean, deps = latest.current.deps) => {
      stopTimer();
      current?.controller.abort();
      const run: Run = { id: ++seq, controller: new AbortController(), deps };
      current = run;
      if (depsChanged) setSnap((s) => ({ ...s, loading: true, error: null, stale: s.data !== null }));

      let promise: Promise<T>;
      try {
        promise = withSignal(run.controller.signal, () => latest.current.fn(run.controller.signal));
      } catch (err) {
        promise = Promise.reject(err);
      }
      promise
        .then(
          (data) => {
            if (current !== run) return;
            setSnap({ data, error: null, loading: false, stale: false, updatedAt: Date.now() });
          },
          (err: unknown) => {
            // An aborted run was replaced or dropped on purpose, not a failure to show.
            if (current !== run || run.controller.signal.aborted) return;
            const message = String((err as { message?: unknown } | null)?.message ?? err);
            setSnap((s) => ({ ...s, error: message, loading: false }));
          },
        )
        .finally(() => {
          if (current !== run) return;
          current = null;
          settledAt = Date.now();
          schedule();
        });
    };

    /** The deps effect: fetch for these `deps`, and let go of the run on cleanup. */
    const attach = (deps: unknown[]) => {
      mounted = true;
      const rehearsal = dropping !== undefined;
      window.clearTimeout(dropping);
      dropping = undefined;
      // React's StrictMode (dev only) unmounts and remounts every component
      // once. Keep the request already running for the same deps rather than
      // aborting it and asking again.
      if (!(rehearsal && current && sameDeps(current.deps, deps))) start(true, deps);

      return () => {
        mounted = false;
        stopTimer();
        const run = current;
        if (!run) return;
        dropping = window.setTimeout(() => {
          dropping = undefined;
          if (current !== run) return;
          current = null;
          run.controller.abort();
        });
      };
    };

    return { attach, schedule, reload: () => start(false) };
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => control.attach(deps), deps);

  // After the deps effect, so a first load is already in flight and nothing extra is armed.
  useEffect(() => control.schedule(), [control, intervalMs]);

  // schedule() refuses to arm while hidden; on return it catches up if a poll came due.
  const polling = Boolean(intervalMs);
  useEffect(() => {
    if (!polling) return;
    const onVisibility = () => control.schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [control, polling]);

  return { ...snap, reload: control.reload };
}
