import { useState } from 'react';
import { Link } from 'react-router-dom';
import { recheckAccess } from '../../shared/hooks/useAuth';

/** What the person is told after pressing Check again, when the page did not open: a change that gives it brings the page itself, and this view goes with it. */
const AFTER_CHECK = {
  idle: '',
  checking: 'Checking…',
  same: 'Nothing has changed: this page is still not on your account.',
  // Said only if this notice is still there: a change that gave this page replaces it with the page. It claims nothing about the page, since what changed may be other pages.
  changed: 'Your pages have changed. If this page is still not on your account, ask an administrator to add it.',
  failed: 'The portal did not answer. Try again in a moment.',
} as const;

/** Shown for a page of the menu that the signed-in user does not have (ADR-0017): the server refuses its data too, so this says why instead of a page of refusals. */
export default function NoAccess({ page, first }: { page: string; first: { to: string; label: string } | null }) {
  const [state, setState] = useState<keyof typeof AFTER_CHECK>('idle');
  const check = async () => {
    setState('checking');
    const result = await recheckAccess();
    setState(result);
  };
  return (
    <div className="state">
      {/* The alert is the sentence that says what is wrong. An alert is read again whole when anything in it changes, so the answer of Check again is beside it and not in it. */}
      <div className="state-label" role="alert">
        <strong>You do not have access to {page}.</strong>
      </div>
      <p className="muted">An administrator gives each person the pages they see. Ask one to add this page to your account, then check again.</p>
      <div className="state-actions">
        {first && (
          <Link className="btn state-action" to={first.to}>
            Go to {first.label}
          </Link>
        )}
        {/* aria-disabled, not disabled: a disabled button drops the focus it holds (UX-61). */}
        <button type="button" className="btn ghost state-action" aria-disabled={state === 'checking'} onClick={() => state !== 'checking' && void check()}>
          Check again
        </button>
      </div>
      <p className="muted" role="status">
        {AFTER_CHECK[state]}
      </p>
    </div>
  );
}
