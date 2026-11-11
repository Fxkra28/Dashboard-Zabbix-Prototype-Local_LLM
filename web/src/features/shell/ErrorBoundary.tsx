import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a page that throws while rendering, so one broken view shows an
 * error card inside the layout instead of blanking the whole portal,
 * sidebar included. Layout keys it by path: moving to another page starts clean.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel">
        <div className="state error">
          <div className="state-title">This page hit an error</div>
          <div className="mono state-detail">{error.message || String(error)}</div>
          <div className="muted state-hint">Other pages still work. Reloading fetches the latest version of the portal.</div>
          <button className="btn state-action" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

const RELOADED_KEY = 'hcml_preload_reload';

/**
 * After a deploy, a tab opened earlier asks for page chunks that no longer
 * exist, and Vite reports `vite:preloadError`. Reload once to pick up the new
 * build. The session flag stops a loop when the chunk is missing for another
 * reason; it clears after a while, so a later deploy can reload again.
 */
export function reloadOnStaleChunks(): void {
  // True while this page load is itself that reload (or one is under way).
  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem(RELOADED_KEY) !== null;
  } catch {
    /* storage blocked: the guard lasts for this page only */
  }
  if (reloaded) {
    window.setTimeout(() => {
      reloaded = false;
      try {
        sessionStorage.removeItem(RELOADED_KEY);
      } catch {
        /* ignore */
      }
    }, 30_000);
  }

  window.addEventListener('vite:preloadError', (event) => {
    if (reloaded) return; // let the error reach the page's error card
    reloaded = true;
    try {
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    event.preventDefault();
    window.location.reload();
  });
}
