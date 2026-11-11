import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import BrandMark from '../../shared/components/BrandMark';

/**
 * Where to go after signing in: the page the session ended on (api/session.ts
 * goToSignIn), but only a path on this site, never another origin.
 */
export function returnPath(search: string): string {
  const next = new URLSearchParams(search).get('next') ?? '';
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (!/^\/(?![/\\])/.test(next) || /[\u0000-\u001f]/.test(next)) return '/';
  try {
    const url = new URL(next, location.origin);
    // The router matches /LOGIN and /%6Cogin to this page too.
    const path = decodeURIComponent(url.pathname).toLowerCase();
    const isLogin = path === '/login' || path.startsWith('/login/');
    return url.origin === location.origin && !isLogin ? next : '/';
  } catch {
    return '/';
  }
}

export default function Login() {
  const nav = useNavigate();
  const { search } = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Checked here, not only by `required`, so a whitespace-only username is
    // refused without a round trip to the BFF.
    if (!username.trim() || !password) {
      setError('Enter a username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      // Drop the cached /api/auth/me result: otherwise signing in as a
      // different user keeps the previous role until a full page reload,
      // and the sidebar shows the wrong menu.
      resetAuthProbe();
      nav(returnPath(search));
    } catch (err) {
      // login() distinguishes wrong credentials from a rate limit or a BFF
      // that is down; not every failure reads "Invalid username or password".
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit} noValidate>
        <BrandMark />
        <h1>HCML Monitoring Portal</h1>
        <p>Sign in to continue</p>

        <div className="field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            // eslint-disable-next-line jsx-a11y/no-autofocus -- signing in is this page's only task
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {/* aria-disabled, not disabled: a disabled button drops the keyboard focus
            it holds, so after a failed sign-in nothing on the page had focus. */}
        <button className="btn" type="submit" aria-disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </main>
  );
}
