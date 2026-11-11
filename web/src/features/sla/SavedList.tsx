import { useEffect, useId, useRef, useState } from 'react';
import { api, HttpFailure } from '../../api';
import { UnreadableAnswer } from '../../guards';
import { domainsList } from './addresses';

/**
 * The saved list of people a report goes to, in the Email and Schedule dialogs: each address with a button to remove it, a box
 * to add one, and a button to delete the whole list. A change is saved at once, and the page is told the list that applies.
 */

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const MAYBE = 'The list may or may not have changed: close this window and open it again to see what it holds.';

/** What a person should read for a failure: the portal's own sentence when it gave one. */
function whyItFailed(err: unknown): string {
  if (err instanceof TypeError) return `The portal could not be reached, or the connection broke while it worked. ${MAYBE}`;
  if (err instanceof UnreadableAnswer) return "The list was changed, but this page could not read the portal's answer. Close this window and open it again to see it.";
  if (err instanceof HttpFailure && !err.told) return `The portal did not answer (HTTP ${err.status}). ${MAYBE}`;
  const said = err instanceof Error ? err.message.trim() : '';
  return said || 'The list was not changed. Try again.';
}

/** What applies after the saved list is gone: the list the portal started with, or nobody. */
const nowApplies = (list: readonly string[]) => (list.length === 0 ? 'No list is saved now.' : `The list the portal started with applies again (${people(list.length)}).`);

export default function SavedList({
  saved,
  max,
  allowedDomains,
  disabled = false,
  onChanged,
}: {
  saved: string[];
  max: number;
  allowedDomains: string[];
  /** The dialog is busy with something else: the view stays, and its controls are off. */
  disabled?: boolean;
  /** The list that applies after a change, so the dialog can follow it. */
  onChanged: (list: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [address, setAddress] = useState('');
  const regionId = useId();
  const askId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  // One change at a time, whatever is pressed meanwhile: the state of `busy` is only seen at the next render.
  const working = useRef(false);
  // The answer can come after the dialog is gone: there is nothing left to update then.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The question takes the focus when it opens, and gives it back to the button that asked when it closes.
  const askedBefore = useRef(false);
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (askedBefore.current) deleteButton.current?.focus();
    askedBefore.current = asking;
  }, [asking]);

  const off = busy || disabled;

  async function change(go: () => Promise<{ list: string[]; removed?: number }>, said: (list: string[], removed?: number) => string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNote('');
    setError('');
    setAsking(false);
    try {
      const { list, removed } = await go();
      onChanged(list);
      if (alive.current) setNote(said(list, removed));
    } catch (err) {
      if (alive.current) setError(whyItFailed(err));
    } finally {
      working.current = false;
      if (alive.current) {
        setBusy(false);
        // The button that was pressed may be gone with its address, which would drop the focus to the page.
        toggle.current?.focus();
      }
    }
  }

  const holds = (list: readonly string[]) => (list.length === 0 ? 'No list is saved now.' : `The list holds ${people(list.length)}.`);

  const deleteList = async () => {
    const answer = await api.sliRecipientsDelete();
    return { list: answer.recipients, removed: answer.removed };
  };

  const remove = (target: string) => {
    const rest = saved.filter((a) => a !== target);
    // A list is never saved empty: taking the last address away is deleting it.
    if (rest.length === 0) return change(deleteList, (list) => `Removed ${target}. ${nowApplies(list)}`);
    return change(async () => ({ list: (await api.sliRecipientsSave(rest)).recipients }), (list) => `Removed ${target}. ${holds(list)}`);
  };

  const add = () => {
    const next = address.trim();
    if (!next || off) return;
    setNote('');
    const already = saved.find((a) => a.toLowerCase() === next.toLowerCase());
    if (already) return setError(`${already} is on the list already.`);
    if (saved.length >= max) return setError(`The list holds the most it can: ${max} addresses.`);
    return change(
      async () => {
        const list = (await api.sliRecipientsSave([...saved, next])).recipients;
        setAddress('');
        return { list };
      },
      (list) => `Added ${next}. ${holds(list)}`,
    );
  };

  const count = saved.length === 0 ? 'none' : people(saved.length);

  return (
    <div className="saved-list">
      <button type="button" className="btn ghost sm" ref={toggle} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((o) => !o)}>
        Saved list ({count})
      </button>
      <div id={regionId} hidden={!open}>
        {open && (
          <>
            {saved.length === 0 ? (
              <p>No list is saved.</p>
            ) : (
              <ul className="saved-list-items">
                {saved.map((a) => (
                  <li key={a}>
                    <span className="mono">{a}</span>
                    <button type="button" className="btn ghost sm" disabled={off} aria-label={`Remove ${a} from the saved list`} onClick={() => void remove(a)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="saved-list-add">
              <input
                type="text"
                name="saved-list-address"
                value={address}
                disabled={off}
                aria-label="Add an address to the saved list"
                spellCheck={false}
                maxLength={320}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void add();
                  }
                }}
              />
              <button type="button" className="btn ghost sm" disabled={off} onClick={() => void add()}>
                Add
              </button>
            </div>
            {allowedDomains.length > 0 && <p className="muted">Only addresses at {domainsList(allowedDomains)} are accepted.</p>}
            {saved.length > 0 &&
              (asking ? (
                // Escape answers the question and goes no further: the dialog around this view would close and lose what was typed.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the key is for the controls inside it
                <div
                  role="alertdialog"
                  aria-labelledby={askId}
                  className="saved-list-ask"
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;
                    e.stopPropagation();
                    setAsking(false);
                  }}
                >
                  <p id={askId}>Delete the saved list of {people(saved.length)}?</p>
                  <button type="button" className="btn ghost sm" ref={keep} onClick={() => setAsking(false)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="btn sm danger"
                    disabled={off}
                    onClick={() =>
                      void change(deleteList, (list, removed) =>
                        removed === 0
                          ? 'The portal has no saved list of its own, so nothing was deleted. The list it started with is the one in use.'
                          : `The saved list was deleted. ${nowApplies(list)}`,
                      )
                    }
                  >
                    Delete the list
                  </button>
                </div>
              ) : (
                <button type="button" className="btn ghost sm" ref={deleteButton} disabled={off} onClick={() => setAsking(true)}>
                  Delete the saved list
                </button>
              ))}
            <div role="status">{busy ? 'Saving…' : note}</div>
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
