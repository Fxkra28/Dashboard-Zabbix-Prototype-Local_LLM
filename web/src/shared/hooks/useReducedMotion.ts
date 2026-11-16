import { useEffect, useState } from 'react';

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
