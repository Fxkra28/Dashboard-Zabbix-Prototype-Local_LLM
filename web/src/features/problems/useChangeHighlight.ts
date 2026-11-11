import { useEffect, useMemo, useRef, useState } from 'react';
import type { Problem } from '../../types';

export type ChangeMark = 'new' | 'cleared';

/** How long a problem that appeared stays marked, and one that cleared stays on screen. */
export const HIGHLIGHT_MS = 10_000;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the user has asked the system for less motion, following changes to the setting. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => window.matchMedia?.(REDUCED_MOTION).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION);
    if (!query) return;
    const onChange = () => setReduce(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

/**
 * Problems that appeared in or cleared from the open list, for the wall
 * screen's short highlight (DESIGN.md section 9). A cleared problem
 * stays on screen, marked, for HIGHLIGHT_MS, so a glance at the wall still
 * catches what just went away. Only one that was on screen before (`shownOf`
 * the previous list) and still has a place on it now is kept, and it leaves for
 * good once worse problems push it off: a row must not vanish and come back
 * later marked "Cleared".
 *
 * `held` are the problems inside a maintenance window. One that goes into a
 * window has not cleared and one that comes out is not new, so neither is
 * marked: it just leaves or returns.
 *
 * The first list only sets the baseline: nothing is new on page load. With
 * `on` false (not the wall, or reduced motion asked for) the baseline keeps up
 * and nothing is marked, so turning it on later does not mark everything that
 * changed meanwhile. `open`, `held` and `shownOf` must keep their identity
 * while nothing changes.
 */
export function useChangeHighlight(
  open: Problem[] | null,
  held: ReadonlySet<string>,
  on: boolean,
  shownOf: (open: Problem[]) => Problem[],
): { marks: ReadonlyMap<string, ChangeMark>; cleared: Problem[] } {
  const previous = useRef<Map<string, Problem> | null>(null);
  const previousHeld = useRef<ReadonlySet<string>>(held);
  // eventid to the time its mark ends
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(new Map());
  const [gone, setGone] = useState<ReadonlyMap<string, { problem: Problem; until: number }>>(new Map());

  useEffect(() => {
    if (!open) return;
    const next = new Map(open.map((p) => [p.eventid, p]));
    const before = previous.current;
    const heldBefore = previousHeld.current;
    previous.current = next;
    previousHeld.current = held;
    if (!before || !on) return;

    const until = Date.now() + HIGHLIGHT_MS;
    const wasShown = new Set(shownOf([...before.values()]).map((p) => p.eventid));
    const added = open.filter((p) => !before.has(p.eventid) && !heldBefore.has(p.eventid));
    const stillPlaced = (p: Problem) => shownOf([...open, p]).some((q) => q.eventid === p.eventid);
    const removed = [...before.values()].filter(
      (p) => !next.has(p.eventid) && !held.has(p.eventid) && wasShown.has(p.eventid) && stillPlaced(p),
    );
    if (added.length) {
      setFresh((m) => new Map([...m, ...added.map((p) => [p.eventid, until] as const)]));
    }
    // One that is open again is no longer cleared; one pushed off the list is gone.
    setGone((m) => {
      const kept = [...m].filter(([id, g]) => !next.has(id) && stillPlaced(g.problem));
      if (!removed.length && kept.length === m.size) return m;
      return new Map([...kept, ...removed.map((p) => [p.eventid, { problem: p, until }] as const)]);
    });
  }, [open, held, on, shownOf]);

  useEffect(() => {
    if (on) return;
    setFresh((m) => (m.size ? new Map() : m));
    setGone((m) => (m.size ? new Map() : m));
  }, [on]);

  // Drop each mark when its time is up.
  useEffect(() => {
    const ends = [...fresh.values(), ...[...gone.values()].map((g) => g.until)];
    if (!ends.length) return;
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setFresh((m) => new Map([...m].filter(([, until]) => until > now)));
        setGone((m) => new Map([...m].filter(([, g]) => g.until > now)));
      },
      Math.max(0, Math.min(...ends) - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [fresh, gone]);

  return useMemo(() => {
    const marks = new Map<string, ChangeMark>();
    for (const id of fresh.keys()) marks.set(id, 'new');
    for (const id of gone.keys()) marks.set(id, 'cleared');
    return { marks, cleared: [...gone.values()].map((g) => g.problem) };
  }, [fresh, gone]);
}
