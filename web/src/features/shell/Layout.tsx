import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import Sidebar, { PAGE_TITLES } from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import TodayDate from './TodayDate';
import { Loading } from '../../shared/components/states';
import NoAccess from './NoAccess';
import ChangePassword from '../auth/ChangePassword';
import { useAuth, resetAuthProbe, recheckAccess } from '../../shared/hooks/useAuth';
import { useTheme, useSidebarRail, type Theme } from './useUiPrefs';
import { logout } from '../../api';
import { focusMain } from '../../shared/hooks/useDialogFocus';
import { useSessionRenewal } from './useSessionRenewal';
import { useAccessWatch } from './useAccessWatch';
import { useWallMode } from './useWallMode';
import { usePageTitle } from './usePageTitle';
import { useTopBarHeight } from './useTopBarHeight';

/** What a page learns from the shell, via useOutletContext. */
export type LayoutContext = { wall: boolean; exitWall: () => void };

/** The address as the router reads it: it ignores case and a trailing slash. */
const keyOf = (pathname: string): string => pathname.replace(/\/+$/, '').toLowerCase() || '/';

/** Pages that are not in the menu but have a title of their own. */
const OUTSIDE_THE_MENU: Record<string, string> = { '/account': 'Account' };

/** A page's menu name, or its own title when it is outside the menu, or null for an address that is not a page. */
export function titleFor(pathname: string): string | null {
  const key = keyOf(pathname);
  return PAGE_TITLES[key] ?? OUTSIDE_THE_MENU[key] ?? null;
}

export default function Layout() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const { me, role, pages } = useAuth();
  // The form that a temporary password forces is swapped for the page in the same render as the answer, so the words that say the password was changed are kept here (UX-71).
  const [passwordChanged, setPasswordChanged] = useState(false);
  const title = titleFor(pathname) ?? 'Page not found';
  // A page of the menu that this user does not have (ADR-0017): the server refuses its data too, so it says so instead of drawing a page of refusals.
  const key = keyOf(pathname);
  const denied = pages !== null && key in PAGE_TITLES && !(key in pages);
  const firstPage = pages ? Object.keys(PAGE_TITLES).find((p) => p in pages) : undefined;
  usePageTitle(title);

  // The route the session landed on, which decides the sidebar's first width.
  const landing = useRef(pathname).current;

  // After a link in the content, or Back, the control that was pressed has left with the old page and focus would fall to the body: the next Tab would start at the skip link again, and a
  // screen reader would hear nothing of the new page. So focus goes to the main area, on a change of page and not on the first one or on a change of the address's query (UX-80).
  // The password was just changed: the page that opens now is where the person goes on from, and the words above it are read (UX-71).
  const noticeUp = passwordChanged && !me?.mustChange;
  useEffect(() => {
    if (!noticeUp) return;
    focusMain();
    const id = setTimeout(() => setPasswordChanged(false), 10_000);
    return () => clearTimeout(id);
  }, [noticeUp]);
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    // A redirect replaces the address: it is the first page being found, not a move the person made, and the first Tab must still reach the skip link.
    if (navigationType === 'REPLACE') return;
    focusMain();
  }, [pathname, navigationType]);
  // The page was added to the account while its notice was up: the Check again button that was pressed has gone with the notice, so focus goes to the page. A move to another page has its rule above.
  const deniedAt = useRef<string | null>(null);
  useEffect(() => {
    if (denied) {
      deniedAt.current = pathname;
      return;
    }
    const was = deniedAt.current;
    deniedAt.current = null;
    if (was !== null && was === pathname) focusMain();
  }, [denied, pathname]);
  const [collapsed, toggleRail, railForced] = useSidebarRail(landing);
  const [theme, setTheme] = useTheme();
  useSessionRenewal(Boolean(me?.authEnabled), () => void recheckAccess());
  useAccessWatch(Boolean(me?.authEnabled));

  const { wall, enter: enterWall, exit: exitWall } = useWallMode();
  const wallToggle = useRef<HTMLButtonElement>(null);
  const topbar = useRef<HTMLElement>(null);
  useTopBarHeight(topbar, !wall);
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
          <header ref={topbar} className="topbar">
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
              {me?.authEnabled && (
                <Link className="btn ghost sm" to="/account">
                  Account
                </Link>
              )}
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
                  {/* aria-disabled, not disabled: a disabled button drops the focus it holds, and after a failed sign-out it had gone (UX-61). */}
                  <button className="btn ghost sm" aria-disabled={signingOut} onClick={() => !signingOut && void signOut()}>
                    {signingOut ? 'Signing out...' : 'Sign out'}
                  </button>
                </>
              )}
            </div>
          </header>
        )}
        <main id="main" className="content">
          {/* Always there, so that a reader that watches it announces the words when they come. */}
          <div role="status">{passwordChanged && !me?.mustChange && <p className="notice">Your password was changed.</p>}</div>
          {/* Pages are lazy-loaded (see App.tsx). The boundary sits here rather
              than around the router so the chrome never blanks between pages.
              The error boundary is keyed by path, so leaving a crashed page resets it. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<Loading />}>
              {me?.mustChange ? (
                <ChangePassword forced onDone={() => setPasswordChanged(true)} />
              ) : denied && key === '/' && firstPage ? (
                <Navigate to={firstPage} replace />
              ) : denied ? (
                <NoAccess page={title} first={firstPage ? { to: firstPage, label: PAGE_TITLES[firstPage] } : null} />
              ) : (
                <Outlet context={{ wall, exitWall } satisfies LayoutContext} />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
