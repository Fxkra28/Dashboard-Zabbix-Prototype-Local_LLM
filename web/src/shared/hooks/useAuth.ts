import { useEffect, useState } from 'react';
import { api, AUTH_CHANGED, isSignedOut, userOrRoleChanged } from '../../api';
import type { Me, ModuleId, Role } from '../../types';

/**
 * Who is signed in, and what may they see.
 *
 * One shared /api/auth/me probe. With auth disabled the BFF reports role "admin", so the scaffold
 * shows everything and nothing has to special-case the unauthenticated path. The answer also says
 * how long the session has left, which `api.me()` records for useSessionRenewal.
 */
/** The same order as the BFF's (security/modules.ts): a guest reads, an operator also acknowledges and closes, an admin also manages users. */
const RANK: Record<Role, number> = { guest: 1, operator: 2, admin: 3 };

export const roleAllows = (has: Role | null, needs: Role) =>
  has !== null && RANK[has] >= RANK[needs];

/**
 * Whether the user holds a module, which is a page of the menu (ADR-0017). An administrator holds every one. A BFF that does not say which modules a user holds (`modules` is
 * absent) is taken to allow them: it still refuses what the user may not read, and the page then shows the refusal.
 */
export const hasModule = (me: Pick<Me, 'modules'> & { role?: Role | null }, id: ModuleId): boolean => me.role === 'admin' || me.modules === undefined || me.modules.includes(id);

let probe: Promise<Me | null> | null = null;

/** The last answer a probe or a re-read delivered, to tell when a later one differs (FR-70). */
let held: Me | null = null;

/** Fired on window when the account is the same person's but the pages or the role differ from what this page held: every hook takes the new answer, which `probe` already holds. */
const ACCESS_CHANGED = 'hcml:access-changed';

/** What an answer says the account may open, in one string, so that two answers can be compared. */
const accessKey = (m: Me): string =>
  JSON.stringify([
    m.user?.name ?? null,
    m.user?.role ?? null,
    Object.entries(m.pages ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [...(m.modules ?? [])].sort(),
    m.mustChange === true,
  ]);

/**
 * Asks the server again who this is and what they may open. The server judges each request by the pages of now, but a page held the list it fetched at load: an administrator who adds a page
 * left the person at the notice to ask for it, and one who removes a page left it in the menu, to open into refusals. A different answer reaches every hook; another person behind the cookie also
 * clears what the pages keep for one person (FR-70).
 */
export async function recheckAccess(): Promise<'changed' | 'same' | 'failed'> {
  if (isSignedOut()) return 'failed';
  let fresh: Me;
  try {
    fresh = await api.me();
  } catch {
    return 'failed';
  }
  const was = held;
  held = fresh;
  probe = Promise.resolve(fresh);
  if (!was || accessKey(was) === accessKey(fresh)) return 'same';
  // What the pages keep for one person goes when the person or their role is another: a list cut for the old role is wrong for the new.
  if ((was.user?.name ?? null) !== (fresh.user?.name ?? null) || (was.user?.role ?? null) !== (fresh.user?.role ?? null)) userOrRoleChanged();
  window.dispatchEvent(new Event(ACCESS_CHANGED));
  return 'changed';
}

/** Re-probe after login/logout, when the role has changed. */
export function resetAuthProbe(): void {
  probe = null;
  held = null;
}

// Registered before any hook's listener, so all of them share one new probe.
window.addEventListener(AUTH_CHANGED, resetAuthProbe);

export function useAuth(): {
  me: Me | null;
  role: Role | null;
  /** The pages this user has, each with the role it needs, as the server states it; null until known. */
  pages: Record<string, Role> | null;
  /** The modules this user holds; null until known or from a BFF that does not say. */
  modules: ModuleId[] | null;
  /** Whether this user holds a module: false until they are known, so a page that waits for the answer does not offer what it may have to take back. */
  can: (id: ModuleId) => boolean;
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
        if (v) held = v;
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
    window.addEventListener(ACCESS_CHANGED, onChange);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener(AUTH_CHANGED, onChange);
      window.removeEventListener(ACCESS_CHANGED, onChange);
    };
  }, []);

  const role = me?.user?.role ?? null;
  return { me, role, pages: me?.pages ?? null, modules: me?.modules ?? null, can: (id) => me !== null && hasModule({ modules: me.modules, role }, id), loading };
}
