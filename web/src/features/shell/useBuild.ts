import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { Build } from './build';

/**
 * Which build the BFF is running, for the sidebar footer. Only a signed-in
 * caller's /api/health carries it, and the shared capabilities probe (useAi) runs once when the page
 * loads, before anyone has signed in, so it never holds it. This asks again when there is a session.
 * A BFF that predates the field, or does not answer, leaves it null and the footer without the line.
 */
export function useBuild(signedIn: boolean): Build | null {
  const [build, setBuild] = useState<Build | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api
      .health()
      .then((h) => {
        const b = h.build;
        if (alive && b && typeof b.commit === 'string') setBuild({ commit: b.commit, time: typeof b.time === 'string' ? b.time : '' });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signedIn]);
  return build;
}
