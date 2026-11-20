import { useId, useState } from 'react';
import { api, AUTH_CHANGED } from '../../api';

/**
 * A person's own password: the current one, then the new one twice. The server holds the new one to its rule (at least 8 characters, and not one that anyone can guess) and says in words
 * when it is not. `forced` is for a password that is a temporary one: nothing else in the portal opens until it is changed.
 */
export default function ChangePassword({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setDone(false);
    if (!current) return setError('Enter your current password.');
    if (next !== again) return setError('The two new passwords are not the same.');
    setBusy(true);
    setError('');
    try {
      await api.changePassword(current, next);
      // The session was renewed by the answer. Every page that holds who is signed in asks again, so the shell drops its "choose a new password" state.
      window.dispatchEvent(new Event(AUTH_CHANGED));
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The password was not changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel change-password" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{forced ? 'Choose a new password' : 'Change your password'}</h2>
      {forced && <p className="notice">Your password was set by an administrator. Choose your own before you continue.</p>}
      <div className="field">
        <label htmlFor={`${id}-current`}>Current password</label>
        <input id={`${id}-current`} name="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-next`}>New password</label>
        <input id={`${id}-next`} name="new" type="password" autoComplete="new-password" aria-describedby={`${id}-rule`} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-again`}>New password again</label>
        <input id={`${id}-again`} name="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      <p id={`${id}-rule`} className="muted">At least 8 characters, and not one that anyone can guess. Changing it signs you out of your other sessions.</p>
      <button className="btn" type="submit" aria-disabled={busy}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      {done && !error && (
        <div className="notice" role="status">
          Your password was changed.
        </div>
      )}
    </form>
  );
}
