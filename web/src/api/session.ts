import { clearConversation, startConversation } from '../shared/lib/chatStore';

/**
 * The session. The token itself lives in an httpOnly cookie that no script on this page can read;
 * the browser sends it with every same-origin request. What the page keeps is when the session
 * ends, by its own clock, from the `expiresIn` the BFF gives with each sign-in, renewal and
 * /api/auth/me.
 */
let session: { endsAt: number; lifeMs: number } | null = null;

/** The user the last answer named, so a renewal can tell when the role changed. */
let lastUser: { name: string; role: string } | null = null;

/** Set by a sign-out in this tab or another, so a renewal on its way out cannot undo it. */
let signedOut = false;

/** True while a sign-out request is out: no renewal starts meanwhile, and the flag above is set only once the server has answered. */
let signingOut = 0;

/** The renewal in flight, which a sign-out waits for: its answer would set the cookie again. */
let renewing: Promise<unknown> | null = null;

const sessionListeners = new Set<() => void>();

/** For what a page keeps for one person: `listener` runs whenever this tab or another signs in, signs out or changes role. */
export function onSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
}

const sessionChanged = () => {
  for (const listener of sessionListeners) {
    try {
      listener();
    } catch (error) {
      console.error('A page that follows the session failed:', error);
    }
  }
};

/** Every POST carries this; with the session in a cookie the BFF refuses one without it. */
export const CSRF = { 'X-HCML-CSRF': '1' };

// Earlier builds kept the token in localStorage. Drop it: it still works as a
// Bearer token until it ends, and nothing reads it now.
try {
  localStorage.removeItem('hcml_token');
} catch {
  /* storage blocked: nothing to clear */
}

/** Note a session the BFF just described: `expiresIn` seconds from now. */
export function recordSession(expiresIn: unknown, user?: { name: string; role: string } | null): void {
  if (typeof expiresIn === 'number' && expiresIn > 0) {
    session = { endsAt: Date.now() + expiresIn * 1000, lifeMs: expiresIn * 1000 };
    signedOut = false;
  }
  if (user) lastUser = { name: user.name, role: user.role };
}

/** When the session ends and how long it had left when the page heard, or null when unknown. */
export const sessionTiming = () => session;

export const isSignedOut = () => signedOut;

/** The user the last answer named, so a page that comes back from the back/forward cache can tell whether someone else signed in meanwhile. */
export const lastKnownUser = () => lastUser;

/** A refused request ends what the page knew of its session; sign-in takes over from there (`goToSignIn`). */
export function endSession(): void {
  session = null;
}

/** Fired on window when the user or role may have changed, here or in another tab, so the menus follow it (useAuth). */
export const AUTH_CHANGED = 'hcml:auth-changed';

type AuthMessage = { type: 'signed-in' | 'signed-out' | 'changed' };

// Tabs share the cookie but not this module: tell the others when the session
// changes hands. Missing before Safari 15.4, where each tab finds out at its
// next request instead.
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('hcml-auth');

const announce = (type: AuthMessage['type']) => channel?.postMessage({ type } satisfies AuthMessage);

/** Another person or another role is signed in on this page: the menus follow it, and so does what a page keeps for one person. */
export function userOrRoleChanged(): void {
  sessionChanged();
  window.dispatchEvent(new Event(AUTH_CHANGED));
}

channel?.addEventListener('message', (e: MessageEvent<AuthMessage>) => {
  if (e.data?.type === 'signed-out') {
    signedOut = true;
    session = null;
    sessionChanged();
    // A renewal this tab had out would set the cookie again: clear it once more when it lands.
    const pending = renewing;
    if (pending) void pending.finally(() => void postLogout().catch(() => undefined));
    goToSignIn();
  } else if (e.data?.type === 'signed-in' || e.data?.type === 'changed') {
    signedOut = false;
    userOrRoleChanged();
  }
});

/**
 * Off to sign in, remembering the page to come back to, so a wall screen
 * returns to its wall mode and a filtered list to its filters.
 */
export function goToSignIn(): void {
  // Every refused session and every sign-out in another tab ends here: the Assistant's conversation goes with it.
  clearConversation();
  if (location.pathname === '/login') return;
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * Swap the session for a fresh one (POST /api/auth/refresh). "signed-out" when
 * the BFF refused it, with the page already on its way to sign-in, or when the
 * user signed out meanwhile; "failed" when the BFF did not answer, worth
 * another try while the session lasts.
 */
export function renewSession(): Promise<'renewed' | 'failed' | 'signed-out'> {
  const run = doRenew();
  renewing = run;
  void run.finally(() => {
    if (renewing === run) renewing = null;
  });
  return run;
}

async function doRenew(): Promise<'renewed' | 'failed' | 'signed-out'> {
  if (signedOut || signingOut > 0) return 'signed-out';
  type Renewed = { user?: { name: string; role: string }; expiresIn?: unknown };
  let res: Response;
  let body: Renewed | null = null;
  // A request that never answers would hold renewal up until the session ran
  // out (nginx waits up to an hour): give up and let the retry take over. A
  // plain controller, since AbortSignal.timeout is missing before Chrome 103 and Safari 16.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    res = await fetch('/bff/api/auth/refresh', { method: 'POST', headers: CSRF, signal: abort.signal });
    if (res.ok) body = (await res.json().catch(() => null)) as Renewed | null;
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
  if (signedOut) return 'signed-out';
  if (res.status === 401) {
    // Refused: stop renewing until a sign-in, here or in another tab.
    signedOut = true;
    session = null;
    goToSignIn();
    return 'signed-out';
  }
  if (typeof body?.expiresIn !== 'number' || !body.user) return 'failed';
  const was = lastUser;
  recordSession(body.expiresIn, body.user);
  if (was && (was.role !== body.user.role || was.name !== body.user.name)) {
    userOrRoleChanged();
    announce('changed');
  }
  return 'renewed';
}

/** Sign in. The BFF sets the session cookie; the answer names the user and how long the session lasts. */
export async function login(username: string, password: string) {
  const res = await fetch('/bff/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ username, password }),
  });
  // Only a 401 means the credentials were wrong: a 429 (rate limit) or a BFF that is down must not
  // read as "Invalid credentials".
  if (res.status === 401) throw new Error('Invalid username or password.');
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(b?.message ?? `Sign-in failed (HTTP ${res.status}). The portal is not answering. Try again, or tell the portal admin.`);
  }
  const data = (await res.json()) as { user: { name: string; role: string }; expiresIn: number };
  recordSession(data.expiresIn, data.user);
  startConversation(); // a sign-in starts a conversation of its own, whoever was here before
  sessionChanged();
  announce('signed-in');
  return data.user;
}

/** POST /api/auth/logout: the BFF clears the cookie. Public, so it works with an expired session too. */
async function postLogout(): Promise<void> {
  // A portal that does not answer would leave the button looking dead for as long as nginx waits (six minutes).
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const res = await fetch('/bff/api/auth/logout', { method: 'POST', headers: CSRF, signal: abort.signal });
    if (!res.ok) throw new Error(`Sign-out failed (HTTP ${res.status}).`);
  } catch (error) {
    if (abort.signal.aborted) throw new Error('Sign-out got no answer from the portal.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sign out, here and in every other tab, once the server has answered: a failed request leaves the page signed in and the
 * caller gets the error. Waits for a renewal in flight, whose answer would set the cookie again.
 */
export async function logout(): Promise<void> {
  signingOut++;
  try {
    await renewing?.catch(() => undefined);
    await postLogout();
  } finally {
    signingOut--;
  }
  // The next person at this workstation must not read the conversation. Only now: a sign-out that failed leaves the page as it was.
  clearConversation();
  signedOut = true;
  session = null;
  lastUser = null;
  sessionChanged();
  announce('signed-out');
}
