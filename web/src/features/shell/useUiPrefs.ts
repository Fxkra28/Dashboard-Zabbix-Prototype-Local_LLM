/**
 * Two pieces of chrome state that outlive a page load: which theme the viewer picked, and whether
 * the sidebar is a rail.
 *
 * Both are UI preference rather than portal data, so localStorage is the right home. It does not
 * contradict the "nothing persists" line in Known gaps, which is about audit trails and saved
 * views, and it needs neither a backend change nor a state library (DESIGN.md section 6).
 *
 * Every access is guarded: Safari in private mode throws on setItem rather than returning, and a
 * portal that cannot render because it could not save a sidebar width is worse than a sidebar that
 * forgets.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable or full; the preference lasts this page only.
  }
};

export type Theme = 'system' | 'light' | 'dark';

// public/theme.js reads the same key before the first paint; a test holds the two together.
export const THEME_KEY = 'hcml.theme';

/**
 * `system` leaves the attribute off, so the stylesheet's
 * `prefers-color-scheme` block decides. Picking a side sets `data-theme`,
 * which outranks it.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = read(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const choose = useCallback((next: Theme) => {
    setTheme(next);
    write(THEME_KEY, next === 'system' ? null : next);
  }, []);

  return [theme, choose];
}

/**
 * Below --bp-md (720px) the page is too narrow for the full sidebar; the .98 leaves no gap at a
 * fractional width under zoom. A test holds this to the token and to the stylesheet's own query.
 */
export const NARROW_QUERY = '(max-width: 719.98px)';

const watchNarrow = (onChange: () => void) => {
  const query = window.matchMedia?.(NARROW_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
};
const isNarrow = () => window.matchMedia?.(NARROW_QUERY).matches ?? false;

/** Whether the window is narrow, following a resize or a change of zoom. False where there is no matchMedia. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(watchNarrow, isNarrow, () => false);
}

const RAIL_KEY = 'hcml.sidebar.collapsed';

/**
 * Whether the sidebar is a rail, the toggle for it, and whether the screen is
 * forcing it. A stored choice always wins. Until there is one, the Dashboard
 * starts collapsed, because that is the route meant to run on a NOC wall and
 * nobody reads nav labels from across a room.
 *
 * The default is decided once, from the route the session landed on, and not
 * again on navigation. Recomputing per route would make the sidebar move under
 * someone who never touched it.
 *
 * On a narrow screen the rail is forced, and never the full sidebar, which
 * would leave the page almost no width. The sidebar still never vanishes
 * (DESIGN.md section 6). The forced rail is not saved: the stored choice is
 * left alone, so a wider window gives back what was chosen.
 */
export function useSidebarRail(landingPath: string): [boolean, () => void, boolean] {
  const [chosen, setChosen] = useState(() => {
    const stored = read(RAIL_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return landingPath === '/';
  });
  const narrow = useNarrowScreen();

  const toggle = useCallback(() => {
    // The rail is forced, so there is nothing to switch and nothing to save.
    if (narrow) return;
    setChosen((current) => {
      write(RAIL_KEY, String(!current));
      return !current;
    });
  }, [narrow]);

  return [chosen || narrow, toggle, narrow];
}
