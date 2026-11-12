import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, HttpFailure } from '../../api';
import type { Freshness, Problem } from '../../types';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { useDialogFocus } from '../../shared/hooks/useDialogFocus';
import { ageWords, momentWords } from '../../shared/lib/freshness';

const MAY_HAVE_BEEN_MADE = 'The change may or may not have been made: look at the problem again before you try it again.';

/** The portal's own sentence when it gave one. When only a proxy or a broken connection answered, nothing says whether the change went. */
function whyItFailed(err: unknown): string {
  if (err instanceof TypeError) return `The portal could not be reached, or the connection broke while it worked. ${MAY_HAVE_BEEN_MADE}`;
  if (err instanceof HttpFailure && !err.told) return `The portal did not answer (HTTP ${err.status}). ${MAY_HAVE_BEEN_MADE}`;
  return String((err as Error)?.message ?? err);
}

/**
 * Acknowledge / close write-back: the portal's only write.
 *
 * Deliberately explicit: this is the one place a click changes something in Zabbix, so it confirms
 * rather than acting on a single tap, and it never offers Close for a trigger that doesn't allow
 * manual close.
 */
/** Zabbix keeps 2048 characters, and the portal's tag in front takes at most 74 of them (a name of 64, the brackets, the word and a space). */
const MAX_NOTE = 2048 - 74;

export default function AckDialog({
  problem,
  onClose,
  onDone,
}: {
  problem: Problem;
  onClose: () => void;
  /** Called once Zabbix has taken the request, with what was asked, so the page can say it is still waiting. */
  onDone: (sent: { acknowledge: boolean; close: boolean }) => void;
}) {
  const [message, setMessage] = useState('');
  const [acknowledge, setAcknowledge] = useState(problem.acknowledged !== '1');
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const messageId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  useDialogFocus(dialog, messageBox);
  // The answer can come after the dialog was closed and the page opened another problem's: that one is not ours to close.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // Whether Zabbix is still collecting. With no zabbix-server running, a close is accepted and never
  // applied, so the user is told before sending. A failed check says nothing: it must not get in the way.
  const [idle, setIdle] = useState<Freshness | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .freshness()
      .then((f) => alive && setIdle(f.stale && f.lastCollectedAt !== null ? f : null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const nothingToDo = !acknowledge && !close && !message.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nothingToDo) return;
    setBusy(true);
    setError('');
    try {
      await api.acknowledge({
        eventids: [problem.eventid],
        message: message.trim() || undefined,
        acknowledge,
        close,
      });
      onDone({ acknowledge, close });
      if (open.current) onClose();
    } catch (err) {
      if (!open.current) return;
      setError(whyItFailed(err));
      // Confirm was disabled while sending, which dropped focus to <body>.
      messageBox.current?.focus();
    } finally {
      if (open.current) setBusy(false);
    }
  };

  // Drawn on the page, not where it is called from: a wrapper with a transform would otherwise become its frame (UX-46).
  return createPortal(
    // A click on the backdrop cancels, unless that would throw away a typed message.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Esc and the close button do this from the keyboard
    <div
      className="drawer-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
      onClick={() => !busy && !message.trim() && onClose()}
    >
      {/* The role sits on a div: HTML lets a form take only search, none or presentation (UX-45). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only keeps the click from reaching the backdrop */}
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <form className="modal-form" onSubmit={submit}>
          <header className="drawer-head" role="none">
            <div>
              <h2 id={titleId}>Acknowledge problem</h2>
              <div className="drawer-sub">
                <SeverityBadge level={problem.severity} />
                <span style={{ marginLeft: 8 }}>{problem.name}</span>
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  {problem.host || 'Unknown host'}
                </div>
              </div>
            </div>
            <button type="button" className="drawer-close" onClick={onClose} aria-label="Close" disabled={busy}>
              ×
            </button>
          </header>

          <div className="drawer-body">
            {idle && idle.lastCollectedAt !== null && (
              <div className="notice warn" role="status">
                Zabbix has collected nothing since {momentWords(idle.lastCollectedAt * 1000)} ({ageWords(idle.ageSeconds ?? 0)} ago).
                A change you send now may not be applied until it collects again.
              </div>
            )}
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor={messageId}>Message (optional)</label>
              <textarea
                id={messageId}
                ref={messageBox}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={MAX_NOTE}
                placeholder="What you found, or what you're doing about it…"
              />
            </div>

            <label className="check">
              <input
                name="acknowledge"
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              <span>
                Acknowledge
                {problem.acknowledged === '1' && <span className="muted">: already acknowledged</span>}
              </span>
            </label>

            <label className={`check${problem.manualClose ? '' : ' disabled'}`}>
              <input
                name="close"
                type="checkbox"
                checked={close}
                disabled={!problem.manualClose}
                onChange={(e) => setClose(e.target.checked)}
              />
              <span>
                Close problem
                {!problem.manualClose && <span className="muted">: this trigger doesn’t allow manual close</span>}
              </span>
            </label>

            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="drawer-foot modal-foot" role="none">
            <span className="muted">This writes to Zabbix, with your name on the message. It can take a few seconds to show.</span>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              {/* Closing a problem cannot be taken back from the portal, so the button says so in red. */}
              <button className={`btn sm${close ? ' danger' : ''}`} type="submit" disabled={busy || nothingToDo}>
                {busy ? 'Sending…' : 'Confirm'}
              </button>
            </span>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
