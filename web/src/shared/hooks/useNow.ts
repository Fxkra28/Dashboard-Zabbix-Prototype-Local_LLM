import { useEffect, useState } from 'react';
import { onServerClockChange, serverNow } from '../lib/clock';

/** The current time by the server's clock, re-read every `everyMs` and whenever the offset of that clock is learned or moves, for ages and staleness that must move on their own (FR-74). */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), everyMs);
    // A page drawn before the first answer began on the machine's own clock: it takes the server's the moment it is heard, not at its next tick.
    const stop = onServerClockChange(() => setNow(serverNow()));
    return () => {
      clearInterval(id);
      stop();
    };
  }, [everyMs]);
  return now;
}
