import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar, { PAGE_TITLES } from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import TodayDate from './TodayDate';
import { Loading } from '../../shared/components/states';
import { useAuth, resetAuthProbe } from '../../shared/hooks/useAuth';
import { useTheme, useSidebarRail, type Theme } from './useUiPrefs';
import { logout } from '../../api';
import { focusMain } from '../../shared/hooks/useDialogFocus';
import { useSessionRenewal } from './useSessionRenewal';
import { useWallMode } from './useWallMode';
import { usePageTitle } from './usePageTitle';

/** What a page learns from the shell, via useOutletContext. */
export type LayoutContext = { wall: boolean; exitWall: () => void };

/** A page's menu name, or null for an address that is not a page. The router ignores case and a trailing slash, so this does too. */
export function titleFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return PAGE_TITLES[path] ?? null;
}

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { me, role } = useAuth();
  const title = titleFor(pathname) ?? 'Page not found';
  usePageTitle(title);

  // The route the session landed on, which decides the sidebar's first width.
  const landing = useRef(pathname).current;
  const [collapsed, toggleRail, railForced] = useSidebarRail(landing);
  const [theme, setTheme] = useTheme();
  useSessionRenewal(Boolean(me?.authEnabled));

  const { wall, enter: enterWall, exit: exitWall } = useWallMode();
  const wallToggle = useRef<HTMLButtonElement>(null);
  const wasWall = useRef(wall);
  useEffect(() => {
    if (wasWall.current === wall) return;
    wasWall.current = wall;
    // The button just pressed has left the page with the chrome it sat in.
    // Focus goes somewhere useful, unless it already went somewhere on its own.
    if (document.activeElement && document.activeElement !== document.body) return;
    if (wall) focusMain();
    else wallToggle.current?.focus();
  }, [wall]);

  // logout() also tells the other tabs. The sign-in page follows only once the portal has signed the
  // person out: until then the cookie still works, so the page stays and says so.
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSignOutFailed(false);
    setSigningOut(true);
    try {
      await logout();
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
      return;
    }
    resetAuthProbe();
    navigate('/login');
  };

  return (
    <div className={`app${wall ? ' wall' : collapsed ? ' rail' : ''}`}>
      {!wall && (
        <>
          {/* First Tab stop: past up to 21 sidebar stops to the page itself (WCAG 2.4.1). */}
          <a
            className="skip-link"
            href="#main"
            onClick={(e) => {
              e.preventDefault();
              focusMain();
            }}
          >
            Skip to content
          </a>
          <Sidebar collapsed={collapsed} locked={railForced} onToggle={toggleRail} />
        </>
      )}
      <div className="main">
        {!wall && (
          <header className="topbar">
            <h1>{title}</h1>
            <div className="right">
              <TodayDate />
              {pathname === '/' && (
                <button
                  ref={wallToggle}
                  type="button"
                  className="btn ghost sm"
                  onClick={enterWall}
                  title="Full screen, larger type, no menus: for a wall display"
                >
                  Wall mode
                </button>
              )}
              {role && <span className={`role-chip ${role}`}>{role}</span>}
              <label className="theme-pick">
                <span className="sr-only">Colour theme</span>
                <select name="theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                  <option value="system">Theme: system</option>
                  <option value="light">Theme: light</option>
                  <option value="dark">Theme: dark</option>
                </select>
              </label>
              {me?.authEnabled && (
                <>
                  {signOutFailed && (
                    <span className="signout-error" role="alert">
                      Sign-out did not reach the portal. You are still signed in. Try again.
                    </span>
                  )}
                  <button className="btn ghost sm" disabled={signingOut} onClick={() => void signOut()}>
                    {signingOut ? 'Signing out...' : 'Sign out'}
                  </button>
                </>
              )}
            </div>
          </header>
        )}
        <main id="main" className="content">
          {/* Pages are lazy-loaded (see App.tsx). The boundary sits here rather
              than around the router so the chrome never blanks between pages.
              The error boundary is keyed by path, so leaving a crashed page resets it. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet context={{ wall, exitWall } satisfies LayoutContext} />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
