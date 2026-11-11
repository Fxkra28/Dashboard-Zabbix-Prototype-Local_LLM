import { useEffect, useId, useRef, useState } from 'react';
import { api, HttpFailure } from '../../api';
import { UnreadableAnswer } from '../../guards';
import type { EmailInfo, EmailSent, ReportFileFormat } from '../../types';
import { roleAllows, useAuth } from '../../shared/hooks/useAuth';
import { domainsList, joinAddresses, splitAddresses, wordsList } from './addresses';
import FileChoices, { nounOf } from './FileChoices';
import ReportDialog, { useReveal } from './ReportDialog';
import ReportSchedule from './ReportSchedule';
import SavedList from './SavedList';
import { readReportStyle, styleSentence } from './reportStyle';
import { monthInWords } from './ReportDownload';

/**
 * Email the month's report, by hand: to the people typed in the box, in the files ticked, in the style chosen for the downloads.
 * Offered to administrators only, once the BFF says email is set up. The sender is the portal's settings and is shown, not chosen.
 * Beside it, the monthly schedule, which sends the same report by itself.
 */

/** What a person should read for a failure: the BFF's own sentence when it gave one. */
const CHECK_FIRST = 'The report may or may not have gone: look under Last sends in the Schedule dialog, or ask the people it was sent to, before you press Send report again.';

function whyItFailed(err: unknown): string {
  // A fetch fails with a TypeError when the connection never opened, and also when it broke after the portal had the request, so the report may be on its way.
  if (err instanceof TypeError) return `The portal could not be reached, or the connection broke while it worked. ${CHECK_FIRST}`;
  // The report went: only the portal's answer could not be read, and a second press would send it again.
  if (err instanceof UnreadableAnswer) return "The report went, but this page could not read the portal's answer. Reload the page before you send it again.";
  // nginx answered and not the portal (a restart, a timeout): nothing says whether the report went.
  if (err instanceof HttpFailure && !err.told) return `The portal did not answer (HTTP ${err.status}). ${CHECK_FIRST}`;
  const said = err instanceof Error ? err.message.trim() : '';
  return said || 'The report did not go. Try again.';
}

/** A send that takes longer than this can be left: the page goes on waiting, and says where the result will be. */
export const LEAVE_AFTER_MS = 30_000;
const WHERE = 'Last sends in the Schedule dialog';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** How a send that was left ended, for the page to say. */
interface Outcome {
  ok: boolean;
  text: string;
}

function summary(sent: EmailSent, asked: boolean): string {
  const refused = sent.refused > 0 ? ` The mail server refused ${sent.refused} address${sent.refused === 1 ? '' : 'es'}.` : '';
  const kept = sent.remembered ? ' The list is saved.' : asked ? ' The report went, but the list could not be saved.' : '';
  return `Sent ${wordsList(sent.files.map((f) => nounOf(f.format)))} to ${people(sent.sent)}.${refused}${kept}`;
}

function EmailDialog({
  month,
  info,
  onClose,
  onKept,
  onLeave,
  onEnded,
}: {
  month: string;
  info: EmailInfo;
  onClose: () => void;
  onKept: () => void;
  /** The send is still out and the person is leaving it: the page takes over from here. */
  onLeave: () => void;
  /** How the send ended, called once, whether or not the dialog is still there. */
  onEnded: (outcome: Outcome) => void;
}) {
  const [files, setFiles] = useState<ReportFileFormat[]>(['pdf']);
  const [to, setTo] = useState(joinAddresses(info.recipients));
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EmailSent | null>(null);
  // True once the report is known to have gone, though the portal's answer could not be read.
  const [went, setWent] = useState(false);
  // Whether the send has been out long enough that the person may leave it.
  const [slow, setSlow] = useState(false);
  const finished = result !== null || went;
  const toId = useId();
  const toBox = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const statusBox = useRef<HTMLDivElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  // The answer can come after the dialog is gone: there is nothing left to update then.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), LEAVE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);

  // The send button is gone once the report went, which would drop the focus it held.
  useEffect(() => {
    if (finished) closeButton.current?.focus();
  }, [finished]);

  const submit = async () => {
    if (busy || finished) return;
    const addresses = splitAddresses(to);
    if (files.length === 0) return setError('Choose at least one file.');
    if (addresses.length === 0) return setError('Add at least one address.');
    setBusy(true);
    setError('');
    try {
      const sent = await api.sliEmail(month, { formats: files, to: addresses, remember, style: readReportStyle() });
      if (sent.remembered) onKept();
      if (open.current) setResult(sent);
      else onEnded({ ok: true, text: summary(sent, remember) });
    } catch (err) {
      if (!open.current) return onEnded({ ok: false, text: whyItFailed(err) });
      if (err instanceof UnreadableAnswer) setWent(true);
      setError(whyItFailed(err));
    } finally {
      if (open.current) setBusy(false);
    }
  };

  const status = busy
    ? slow
      ? `Still sending. You can close this window: the send continues, and its result will be under ${WHERE}.`
      : 'Sending. A month that is not loaded yet can take a minute.'
    : result
      ? summary(result, remember)
      : '';
  useReveal(statusBox, status);
  useReveal(errorBox, error);
  const limit = [`Up to ${info.max} addresses, one on each line or separated by commas.`, info.allowedDomains.length > 0 ? `Only addresses at ${domainsList(info.allowedDomains)} are accepted.` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <ReportDialog
      title="Email the SLA report"
      sub={`${monthInWords(month)}, both methods`}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      initialFocus={toBox}
      note="This sends the report outside the portal."
      actions={
        finished ? (
          <button type="button" className="btn sm" ref={closeButton} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {busy && slow && (
              <button type="button" className="btn ghost sm" onClick={onLeave}>
                Close, the send continues
              </button>
            )}
            {/* Not `disabled` while it works: that would drop the keyboard focus the button holds. */}
            <button className="btn sm" type="submit" aria-disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </>
        )
      }
    >
      <FileChoices chosen={files} onChange={setFiles} disabled={busy || finished} />
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor={toId}>Send to</label>
        <textarea
          id={toId}
          ref={toBox}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          rows={4}
          maxLength={2000}
          spellCheck={false}
          disabled={busy || finished}
          aria-describedby={`${toId}-limit`}
        />
        <span id={`${toId}-limit`} className="muted">
          {limit}
        </span>
      </div>
      <label className={`check${busy || finished ? ' disabled' : ''}`}>
        <input type="checkbox" name="remember" checked={remember} disabled={busy || finished} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember this list for next time</span>
      </label>
      <p className="muted">The saved list is also the one the monthly send goes to.</p>
      <SavedList
        saved={info.recipients}
        max={info.max}
        allowedDomains={info.allowedDomains}
        disabled={busy || finished}
        onChanged={(list) => {
          // The box follows the saved list, unless the person has typed a list of their own.
          setTo((box) => (box === joinAddresses(info.recipients) ? joinAddresses(list) : box));
          onKept();
        }}
      />
      {!info.kept && <p className="muted">This portal has no data folder, so it forgets the list when it restarts.</p>}
      {/* A long address wraps in the box instead of widening it at a narrow width or a large zoom. */}
      <p style={{ overflowWrap: 'anywhere' }}>
        <span className="muted">From</span> {info.from}
      </p>
      <p className="muted">{styleSentence(readReportStyle(), files.includes('csv'))} Change it with the Number and date style button.</p>
      {error && (
        <div className="login-error" role="alert" ref={errorBox}>
          {error}
        </div>
      )}
      <div role="status" ref={statusBox}>
        {status}
      </div>
    </ReportDialog>
  );
}

export default function EmailReport({ month, disabled = false }: { month: string; disabled?: boolean }) {
  const { role } = useAuth();
  const admin = roleAllows(role, 'admin');
  const [info, setInfo] = useState<EmailInfo | null>(null);
  const [open, setOpen] = useState(false);
  // A send the person left while it was out, and then how it ended.
  const [away, setAway] = useState<{ month: string; outcome: Outcome | null } | null>(null);

  // Asked once the person is known to be an administrator. A failed check offers nothing and says nothing: it must not get in the way.
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    api
      .sliEmailInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [admin]);

  // Either dialog can change the saved list, and the next one to open starts from it. A failed look leaves what is shown as it was.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = () => {
    api
      .sliEmailInfo()
      .then((i) => mounted.current && setInfo(i))
      .catch(() => undefined);
  };

  if (!admin || !info?.enabled) return null;
  const sending = away !== null && away.outcome === null;
  return (
    <div className="field">
      <div className="report-actions" role="group" aria-label={`Email the SLA report for ${monthInWords(month)}, both methods`}>
        <button type="button" className="btn ghost sm" disabled={disabled || sending} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Email report
        </button>
        <ReportSchedule info={info} onSaved={refresh} />
      </div>
      {away && (
        <div className={`notice${away.outcome?.ok === false ? ' warn' : ''}`} role={away.outcome?.ok === false ? 'alert' : 'status'}>
          {away.outcome ? away.outcome.text : `The report email for ${monthInWords(away.month)} is still being sent. When it ends, look under ${WHERE}.`}
          {away.outcome && (
            <button type="button" className="btn ghost sm" onClick={() => setAway(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
      {open && (
        <EmailDialog
          month={month}
          info={info}
          onClose={() => setOpen(false)}
          onKept={refresh}
          onLeave={() => {
            setOpen(false);
            setAway({ month, outcome: null });
          }}
          onEnded={(outcome) => mounted.current && setAway((now) => (now && now.outcome === null ? { ...now, outcome } : now))}
        />
      )}
    </div>
  );
}
