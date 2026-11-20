import { useEffect } from 'react';
import { isSignedOut } from '../../api';
import { recheckAccess } from '../../shared/hooks/useAuth';

/** Between two re-reads that a tab being shown or focused asks for. */
const MIN_GAP_MS = 60_000;
/** How often a tab that stays in view, a wall screen, asks again by itself. */
const EVERY_MS = 10 * 60_000;

/**
 * Keeps the menus and the open page in step with the pages an administrator gives the person (FR-70). The server judges each request by the pages of now; the page held the list it fetched at
 * load. It asks again when the tab is shown or gains focus, at most once a minute, and every ten minutes while it stays in view. The renewal of the session asks too (useSessionRenewal).
 */
export function useAccessWatch(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    const ask = () => {
      last = Date.now();
      if (!isSignedOut()) void recheckAccess();
    };
    const onWake = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < MIN_GAP_MS) return;
      ask();
    };
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') ask();
    }, EVERY_MS);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [enabled]);
}
