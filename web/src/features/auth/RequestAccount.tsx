import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api';
import type { ModuleId, RequestInfo } from '../../types';

/**
 * A person who cannot sign in asks for an account (FR-62): a name, the pages they want and why. It only leaves a request: an administrator approves it on the Users page and passes on a temporary
 * password, as for every account. The link is drawn only when the portal says the form is on (off unless the setting is on), and the answer says only that the request was received.
 */
export function RequestAccountLink({ onOpen, open }: { onOpen: () => void; open: boolean }) {
  const [info, setInfo] = useState<RequestInfo | null>(null);
  useEffect(() => {
    let alive = true;
    // A portal that does not answer, or answers in a shape this page does not know, offers nothing: signing in is the page's task.
    api.requestInfo().then(
      (answer) => alive && setInfo(answer),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  if (!info?.enabled || open) return null;
  return (
    <p className="login-alt">
      <button type="button" className="link-button" onClick={onOpen}>
        Ask for an account
      </button>
    </p>
  );
}

export default function RequestAccount({ onClose }: { onClose: () => void }) {
  const id = useId();
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [name, setName] = useState('');
  const [pages, setPages] = useState<ModuleId[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    api.requestInfo().then(
      (answer) => alive && setInfo(answer),
      () => alive && setError('The portal did not answer. Try again in a moment.'),
    );
    return () => {
      alive = false;
    };
  }, []);
  // Focus goes to the heading of what is on screen, so that a keyboard does not start again from the top.
  useEffect(() => title.current?.focus(), [sent]);

  const nameMax = info?.nameMax ?? 80;
  const reasonMax = info?.reasonMax ?? 500;
  const toggle = (page: ModuleId, on: boolean) => setPages(on ? [...pages, page] : pages.filter((p) => p !== page));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (name.trim().length < 2) return setError('Enter your name.');
    if (pages.length === 0) return setError('Choose at least one page.');
    if (reason.trim().length < 3) return setError('Say what you need the account for.');
    setBusy(true);
    setError('');
    try {
      await api.sendRequest({ name: name.trim(), pages, reason: reason.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request was not sent.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="login-card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} ref={title} tabIndex={-1}>
          Your request was received
        </h2>
        <p role="status">An administrator will look at it. If they approve it, they will pass on a temporary password, which you change when you first sign in.</p>
        <button type="button" className="btn" onClick={onClose}>
          Back to sign in
        </button>
      </section>
    );
  }

  return (
    <form className="login-card" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={title} tabIndex={-1}>
        Ask for an account
      </h2>
      <p className="muted">An administrator reads the request and decides. Nothing here signs you in.</p>
      <div className="field">
        <label htmlFor={`${id}-name`}>Your name</label>
        <input id={`${id}-name`} name="name" type="text" autoComplete="name" maxLength={nameMax} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset className="field user-modules">
        <legend className="field-label">The pages you need</legend>
        {(info?.pages ?? []).map((p) => (
          <label key={p.id} className="check">
            <input type="checkbox" name={`page-${p.id}`} checked={pages.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
            <span>{p.label}</span>
          </label>
        ))}
        {info === null && !error && <p className="muted">Loading the pages…</p>}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-reason`}>What you need the account for</label>
        <textarea id={`${id}-reason`} name="reason" rows={4} maxLength={reasonMax} aria-describedby={`${id}-count`} value={reason} onChange={(e) => setReason(e.target.value)} />
        <span id={`${id}-count`} className="muted">
          {reason.length} of {reasonMax} characters
        </span>
      </div>
      {/* aria-disabled, not disabled: a disabled button drops the keyboard focus it holds. */}
      <div className="controls">
        <button className="btn" type="submit" aria-disabled={busy || info === null}>
          {busy ? 'Sending…' : 'Send the request'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Back to sign in
        </button>
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
