import { useEffect, useId, useRef, useState } from 'react';
import { api, HttpFailure } from '../../api';
import { UnreadableAnswer } from '../../guards';
import type { EmailInfo, ReportFileFormat, ReportStyle, ScheduleInfo, SendRecord } from '../../types';
import { formatDateTime } from '../../shared/lib/time';
import { domainsList, joinAddresses, SEE_EACH_OTHER, splitAddresses, wordsList } from './addresses';
import FileChoices, { nounOf } from './FileChoices';
import { monthInWords } from './ReportDownload';
import ReportDialog, { useReveal } from './ReportDialog';
import { readReportStyle } from './reportStyle';
import SavedList from './SavedList';
import StyleFields from './StyleFields';

/**
 * The monthly send: the report of the month that has closed goes by itself, on a day and at a time, to the people listed.
 * Offered to administrators, beside Email report, once email is set up. What the portal keeps for it, and what it does when
 * a send fails, is in docs/setup/18-automated-reporting.md.
 */

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** What a person should read for a failure: the BFF's own sentence when it gave one. */
const SAVE_UNSURE = 'The schedule may not have been saved: close this window and open Schedule again to see what it holds.';

/** What a person should read for a failure of the read that opens the dialog, or of the save: the two need different words, since a read changes nothing. */
function whyItFailed(err: unknown, doing: 'load' | 'save'): string {
  if (doing === 'load') {
    if (err instanceof TypeError) return 'The portal could not be reached. Check the connection and try again.';
    if (err instanceof UnreadableAnswer) return err.message;
    if (err instanceof HttpFailure && !err.told) return `The portal did not answer (HTTP ${err.status}). Try again in a minute.`;
    const said = err instanceof Error ? err.message.trim() : '';
    return said || 'The schedule could not be read. Try again.';
  }
  // A fetch fails with a TypeError when the connection never opened, and also when it broke after the portal had the request.
  if (err instanceof TypeError) return `The portal could not be reached, or the connection broke while it worked. ${SAVE_UNSURE}`;
  // Saved: only the portal's answer could not be read.
  if (err instanceof UnreadableAnswer) return "The schedule was saved, but this page could not read the portal's answer. Reload the page to see it.";
  // nginx answered and not the portal (a restart, a timeout): nothing says whether it was saved.
  if (err instanceof HttpFailure && !err.told) return `The portal did not answer (HTTP ${err.status}). ${SAVE_UNSURE}`;
  const said = err instanceof Error ? err.message.trim() : '';
  return said || 'The schedule was not saved. Try again.';
}

const REASONS: Record<string, string> = {
  login: 'the mail login was refused',
  connect: 'the mail server could not be reached',
  timeout: 'the mail server did not answer',
  tls: 'the secure connection failed',
  recipients: 'the addresses were refused',
  rejected: 'the mail server did not accept it',
  other: 'the message could not be sent',
  zabbix: 'Zabbix could not be read',
  empty: 'the report had no device in it',
  error: 'something went wrong',
  changed: 'the schedule was changed',
};
const reasonOf = (r: SendRecord) => (r.reason && REASONS[r.reason] ? ` (${REASONS[r.reason]})` : '');

export function sendLine(r: SendRecord, tz: string): string {
  const head = `${monthInWords(r.month)}: `;
  const when = formatDateTime(r.at * 1000, tz);
  const who = r.trigger === 'manual' ? `by ${r.by}` : 'by the schedule';
  switch (r.outcome) {
    case 'sent':
      return `${head}sent ${when} ${who}, ${wordsList(r.formats.map(nounOf))} to ${people(r.recipients)}${r.refused > 0 ? `, ${r.refused} refused` : ''}.`;
    case 'sending':
      return `${head}not sent yet, ${r.attempts} ${r.attempts === 1 ? 'try' : 'tries'} so far${reasonOf(r)}. Last try ${when}.`;
    case 'failed':
      return `${head}not sent${reasonOf(r)}. The last try was ${when} ${who}.`;
    case 'missed':
      return `${head}missed. The portal was not running in the week after it was due.`;
  }
}

function nextSentence(info: ScheduleInfo): string {
  if (!info.available) return '';
  if (!info.schedule) return 'No schedule is set. The report goes only when someone presses Email report.';
  if (!info.schedule.enabled) return 'The schedule is off. The report goes only when someone presses Email report.';
  if (!info.next) return '';
  const when = formatDateTime(info.next.at * 1000, info.timezone);
  return info.next.retrying
    ? `The report for ${monthInWords(info.next.month)} has not gone yet. The portal tries again at ${when}.`
    : `Next send: the report for ${monthInWords(info.next.month)}, on ${when}.`;
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** What the form holds: the schedule's fields as the person edits them, the two lists as the text in their boxes. */
interface FormState {
  enabled: boolean;
  day: number;
  time: string;
  files: ReportFileFormat[];
  to: string;
  notify: string;
  style: ReportStyle;
}

const formOf = (info: ScheduleInfo): FormState => ({
  enabled: info.schedule?.enabled ?? true,
  day: info.schedule?.day ?? 1,
  time: info.schedule?.time ?? '00:00',
  files: info.schedule?.formats ?? ['pdf'],
  to: joinAddresses(info.recipients),
  notify: joinAddresses(info.schedule?.notify ?? []),
  style: info.schedule?.style ?? readReportStyle(),
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One dialog from the press of the button to the close: first it reads the schedule, then it is the form. */
function ScheduleDialog({ mail, onClose, onSaved }: { mail: EmailInfo; onClose: () => void; onSaved?: (list?: string[]) => void }) {
  const [info, setInfo] = useState<ScheduleInfo | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const enabledId = useId();
  const dayId = useId();
  const timeId = useId();
  const toId = useId();
  const notifyId = useId();
  const first = useRef<HTMLInputElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  // An answer can come after the dialog is gone: there is nothing left to update then.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setLoadError('');
    api
      .sliSchedule()
      .then((i) => {
        if (!alive.current) return;
        setInfo(i);
        setForm(formOf(i));
      })
      .catch((err: unknown) => alive.current && setLoadError(whyItFailed(err, 'load')));
  }, [attempt]);

  // The switch does not exist until the schedule has been read, so that is when the focus can go there.
  const ready = form !== null;
  useEffect(() => {
    if (ready) first.current?.focus();
  }, [ready]);
  useReveal(statusLine, saved);
  useReveal(errorBox, error);

  const patch = (change: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...change } : f));
    setSaved(false);
  };

  const submit = async () => {
    if (busy || !form || !info) return;
    const recipients = splitAddresses(form.to);
    if (form.files.length === 0) return setError('Choose at least one file.');
    if (form.enabled && recipients.length === 0) return setError('Add at least one address to send to.');
    if (!TIME.test(form.time)) return setError('Set the time of day, such as 00:00.');
    setBusy(true);
    setError('');
    try {
      const next = await api.sliScheduleSave({
        enabled: form.enabled,
        day: form.day,
        time: form.time,
        formats: form.files,
        recipients,
        notify: splitAddresses(form.notify),
        style: form.style,
      });
      onSaved?.(next.recipients);
      if (!alive.current) return;
      setInfo(next);
      setForm(formOf(next));
      setSaved(true);
    } catch (err) {
      if (alive.current) setError(whyItFailed(err, 'save'));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const off = busy || !info?.available;
  const limits = info
    ? [`Up to ${info.max} addresses, one on each line or separated by commas.`, info.allowedDomains.length > 0 ? `Only addresses at ${domainsList(info.allowedDomains)} are accepted.` : '']
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <ReportDialog
      title="Send the SLA report every month"
      sub={info ? `Times are in ${info.timezone}. Sent from ${mail.from}.` : undefined}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      initialFocus={first}
      note={info ? 'Sends only while the portal runs and can reach Zabbix. A send that fails is tried again for a week.' : ''}
      actions={
        <>
          <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>
            Close
          </button>
          {info && (
            <button className="btn sm" type="submit" aria-disabled={off} aria-busy={busy || undefined} disabled={!info.available}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
          {!info && loadError && (
            <button type="button" className="btn sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          )}
        </>
      }
    >
      {!info || !form ? (
        loadError ? (
          <div className="login-error" role="alert">
            {loadError}
          </div>
        ) : (
          <div role="status">Reading the schedule…</div>
        )
      ) : (
        <>
          {!info.available && (
            <div className="notice warn" role="status">
              {info.why}
            </div>
          )}
          <p role="status" ref={statusLine}>
            {saved ? `Saved. ${nextSentence(info)}` : nextSentence(info)}
          </p>

          <label className={`check${off ? ' disabled' : ''}`} htmlFor={enabledId}>
            <input id={enabledId} ref={first} type="checkbox" checked={form.enabled} disabled={off} onChange={(e) => patch({ enabled: e.target.checked })} />
            <span>Send the report every month</span>
          </label>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor={dayId}>Day of the month</label>
            <select id={dayId} value={form.day} disabled={off} onChange={(e) => patch({ day: Number(e.target.value) })}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="muted">The report of the month before goes on this day. Days 29 to 31 are left out, so that every month has the day.</span>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor={timeId}>Time of day</label>
            <input id={timeId} type="time" value={form.time} disabled={off} onChange={(e) => patch({ time: e.target.value })} />
            <span className="muted">The portal waits ten minutes after this, so that Zabbix has the last values of the month.</span>
          </div>
          <FileChoices chosen={form.files} onChange={(files) => patch({ files })} disabled={off} />
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor={toId}>Send to</label>
            <textarea id={toId} value={form.to} rows={4} maxLength={2000} spellCheck={false} disabled={off} aria-describedby={`${toId}-limit`} onChange={(e) => patch({ to: e.target.value })} />
            <span id={`${toId}-limit`} className="muted">
              {limits} {SEE_EACH_OTHER} The same list is the one the Email report button starts with.
            </span>
          </div>
          <SavedList
            saved={info.recipients}
            max={info.max}
            allowedDomains={info.allowedDomains}
            disabled={off}
            onChanged={(list) => {
              // The box follows the saved list, unless the person has edited it.
              setForm((f) => (f && f.to === joinAddresses(info.recipients) ? { ...f, to: joinAddresses(list) } : f));
              setInfo((i) => (i ? { ...i, recipients: list } : i));
              onSaved?.(list);
            }}
          />
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor={notifyId}>If a send fails, also tell</label>
            <textarea id={notifyId} value={form.notify} rows={2} maxLength={1000} spellCheck={false} disabled={off} onChange={(e) => patch({ notify: e.target.value })} />
            <span className="muted">
              Up to {info.maxNotify} addresses. They are told once after the third failed try, once when the portal gives up, and once when the mail server refuses some of the addresses. A failure is also on this page and in the log.
            </span>
          </div>
          <StyleFields style={form.style} onChange={(style) => patch({ style })} disabled={off} />

          {info.sends.length > 0 && (
            <div className="field">
              <span className="field-label">Last sends</span>
              <ul>
                {info.sends.map((r) => (
                  <li key={`${r.trigger}-${r.month}-${r.at}`} className="muted">
                    {sendLine(r, info.timezone)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <div className="login-error" role="alert" ref={errorBox}>
              {error}
            </div>
          )}
        </>
      )}
    </ReportDialog>
  );
}

export default function ReportSchedule({ info, onSaved }: { info: EmailInfo; onSaved?: (list?: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn ghost sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Schedule
      </button>
      {open && <ScheduleDialog mail={info} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}
