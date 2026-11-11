import { useEffect, useState } from 'react';

/** The current time, re-read every `everyMs`, for ages and staleness that must move on their own. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
