import { useEffect } from 'react';
import { isSignedOut, renewSession, sessionTiming } from '../../api';

/** Renew this long before the session ends, or at three quarters of what was left when that comes first. */
const MARGIN_MS = 60 * 60_000;
/**
 * How often the deadline is looked at again. A timer does not run while the
 * machine sleeps, so one 11-hour timer fired an hour late after an hour's nap.
 */
const CHECK_MS = 60_000;
/** After a failed renewal: retry soon, backing off, until the session runs out and a request signs the page out. */
const RETRY_MS = 60_000;
const RETRY_MAX_MS = 10 * 60_000;
/** Floor between two renewals, so no arithmetic surprise can become a request loop. */
const MIN_GAP_MS = 30_000;

/**
 * Keeps an open portal signed in, for every user, for as long as the page stays
 * open (DESIGN.md section 9, "Wall sign-in"). A closed tab renews nothing, so
 * its session runs out as before; so does one on a machine that slept past it.
 *
 * The page cannot read its token (it is an httpOnly cookie), so the deadline
 * comes from the `expiresIn` the BFF sent with the last sign-in, renewal or
 * /api/auth/me, counted from when this page received it, never an expiry
 * against the local clock: a wall PC whose clock is hours off still renews on
 * time. It is checked every minute and whenever the page wakes, gains focus or
 * comes back online. With no known end, which /api/auth/me prevents, it renews
 * straight away.
 */
export function useSessionRenewal(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = RETRY_MS;
    // No attempt before this: the gap after a renewal, or the backoff after a failure.
    let notBefore = 0;

    const dueIn = () => {
      const session = sessionTiming();
      if (session === null) return 0;
      return session.endsAt - Math.min(MARGIN_MS, session.lifeMs / 4) - Date.now();
    };
    const wait = () => Math.max(dueIn(), notBefore - Date.now());

    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), Math.max(0, Math.min(CHECK_MS, ms)));
    };

    const tick = async () => {
      if (!alive || busy) return;
      // Signed out: keep watching, cheaply, in case another tab signs in again.
      if (isSignedOut()) return arm(CHECK_MS);
      if (wait() > 0) return arm(wait());
      busy = true;
      let outcome: Awaited<ReturnType<typeof renewSession>>;
      try {
        outcome = await renewSession();
      } catch {
        outcome = 'failed';
      } finally {
        busy = false;
      }
      if (!alive) return;
      // Signed out meanwhile (maybe by another tab): keep watching, since a
      // later sign-in in any tab brings a session this page must renew too.
      if (outcome === 'signed-out') return arm(CHECK_MS);
      if (outcome === 'renewed') {
        retry = RETRY_MS;
        notBefore = Date.now() + MIN_GAP_MS;
      } else {
        notBefore = Date.now() + retry;
        retry = Math.min(retry * 2, RETRY_MAX_MS);
      }
      arm(wait());
    };

    const onWake = () => {
      if (document.visibilityState !== 'hidden') void tick();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [enabled]);
}
