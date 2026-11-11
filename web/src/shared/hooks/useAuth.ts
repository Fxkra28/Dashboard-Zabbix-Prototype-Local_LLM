import { useEffect, useState } from 'react';
import { api, AUTH_CHANGED } from '../../api';
import type { Me, Role } from '../../types';

/**
 * Who is signed in, and what may they see.
 *
 * One shared /api/auth/me probe. With auth disabled the BFF reports role "admin", so the scaffold
 * shows everything and nothing has to special-case the unauthenticated path. The answer also says
 * how long the session has left, which `api.me()` records for useSessionRenewal.
 */
/** The same order as the BFF's (security/auth.ts): a wall screen sees the network pages and never writes. */
const RANK: Record<Role, number> = { viewer: 1, wall: 2, operator: 3, admin: 4 };

export const roleAllows = (has: Role | null, needs: Role) =>
  has !== null && RANK[has] >= RANK[needs];

let probe: Promise<Me | null> | null = null;

/** Re-probe after login/logout, when the role has changed. */
export function resetAuthProbe(): void {
  probe = null;
}

// Registered before any hook's listener, so all of them share one new probe.
window.addEventListener(AUTH_CHANGED, resetAuthProbe);

export function useAuth(): {
  me: Me | null;
  role: Role | null;
  /** The role each menu page needs, as the server states it; null until known. */
  pages: Record<string, Role> | null;
  loading: boolean;
} {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 5_000;

    // A 401 never lands here (request() signs the user out), so null means the BFF did not answer:
    // a restart or a 502. Caching that for the whole tab would hide Sign out, the role menus and
    // Acknowledge until a reload (useAi had the same bug), so a failure is forgotten and asked
    // again, backing off.
    const load = () => {
      probe ??= api.me().catch(() => {
        probe = null;
        return null;
      });
      void probe.then((v) => {
        if (!alive) return;
        setMe(v);
        setLoading(false);
        if (v === null) {
          timer = setTimeout(load, delay);
          delay = Math.min(delay * 2, 60_000);
        }
      });
    };
    load();
    // A renewal, or another tab's sign-in, brought a different user or role:
    // ask again, so the menus and the role chip follow what the BFF now enforces.
    const onChange = () => {
      clearTimeout(timer);
      delay = 5_000;
      load();
    };
    window.addEventListener(AUTH_CHANGED, onChange);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener(AUTH_CHANGED, onChange);
    };
  }, []);

  return { me, role: me?.user?.role ?? null, pages: me?.pages ?? null, loading };
}
