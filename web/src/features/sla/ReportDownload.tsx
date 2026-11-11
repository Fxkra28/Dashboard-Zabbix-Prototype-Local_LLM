import { useEffect, useRef, useState } from 'react';
import { api, HttpFailure, type ReportFormat } from '../../api';
import { REVOKE_AFTER_MS, saveFile } from '../../shared/lib/saveFile';
import ReportStyleButton from './ReportStyleButton';
import { readReportStyle } from './reportStyle';

/**
 * Download a month's SLA report as a PDF, an Excel file or a zip of CSV files. The BFF builds the
 * file from the same figures the page shows (GET /api/sli/export); this only
 * fetches it and hands it to the browser.
 */

/** The file always holds both methods, so the toggle beside the buttons does not change it. */
const BOTH_METHODS = 'Both methods, strict and HCML’s report method, whichever one the page shows';

const FORMATS: { format: ReportFormat; label: string; noun: string; hint: string }[] = [
  { format: 'pdf', label: 'PDF report', noun: 'PDF', hint: BOTH_METHODS },
  { format: 'xlsx', label: 'Excel report', noun: 'Excel', hint: BOTH_METHODS },
  { format: 'csv', label: 'CSV report', noun: 'CSV', hint: `${BOTH_METHODS}, as one zip with a CSV file for each table` },
];

export { REVOKE_AFTER_MS };
/** A request that has not answered by now is given up on, so the buttons never stay shut for good. */
export const GIVE_UP_AFTER_MS = 440_000;
/** Long enough for "ready" to be heard, short enough that nobody meets it later as stale news. */
export const READY_FOR_MS = 6_000;

/** "August 2026". The label in shared/lib/time.ts abbreviates the month, and this one is read aloud. */
export function monthInWords(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 15)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** What a person should read for a failure: the BFF's own words when it gave any, else a plain sentence. */
function whyItFailed(err: unknown, gaveUp: boolean): string {
  if (gaveUp) return 'It took too long. Try again in a minute.';
  if (err instanceof HttpFailure && !err.told) {
    return `The portal did not answer (HTTP ${err.status}). Try again in a minute.`;
  }
  // A fetch that never reached the portal fails with a TypeError, worded differently by each browser.
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return 'The portal could not be reached. Check the connection and try again.';
  }
  const said = err instanceof Error ? err.message.trim() : '';
  return said || 'Something went wrong. Try again.';
}

export default function ReportDownload({ month, disabled = false }: { month: string; disabled?: boolean }) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  // Counts the months and mounts these buttons have been through. A request that ends under another
  // count no longer owns the buttons, but its file is still saved: the person asked for it, and a
  // download that ends quietly because they looked at another page would be the worse surprise.
  const epoch = useRef(0);
  // Whether a request is out, which is also what turns a second click away.
  const running = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout>>();

  // A new month is a new report: forget the old one's error and free the buttons for it.
  useEffect(() => {
    setBusy(null);
    setError(null);
    setStatus('');
    running.current = false;
    return () => {
      epoch.current += 1;
      clearTimeout(readyTimer.current);
    };
  }, [month]);

  async function download(format: ReportFormat, noun: string) {
    if (running.current) return;
    const mine = epoch.current;
    const owns = () => epoch.current === mine;
    running.current = true;
    clearTimeout(readyTimer.current);
    setBusy(format);
    setError(null);
    setStatus(`Preparing the ${noun} report`);

    const stop = new AbortController();
    let gaveUp = false;
    const giveUp = setTimeout(() => {
      gaveUp = true;
      stop.abort();
    }, GIVE_UP_AFTER_MS);
    try {
      const { blob, fileName } = await api.sliExport(month, format, stop.signal, readReportStyle());
      saveFile(blob, fileName);
      if (owns()) {
        setStatus(`${noun} report ready`);
        readyTimer.current = setTimeout(() => setStatus(''), READY_FOR_MS);
      }
    } catch (err) {
      if (owns()) {
        setStatus('');
        setError(`Couldn’t prepare the ${noun} report: ${whyItFailed(err, gaveUp)}`);
      }
    } finally {
      clearTimeout(giveUp);
      if (owns()) {
        running.current = false;
        setBusy(null);
      }
    }
  }

  return (
    <>
      {/* No label line above the buttons: the controls row aligns its items to the bottom already, and an
          empty line would leave a gap of dead space whenever the buttons wrap onto a row of their own. */}
      <div className="field">
        <div
          className="report-actions"
          role="group"
          aria-label={`Download the SLA report for ${monthInWords(month)}, both methods`}
        >
          {FORMATS.map(({ format, label, noun, hint }) => (
            <button
              key={format}
              type="button"
              className="btn ghost sm"
              disabled={disabled}
              title={hint}
              // Not `disabled` while a download runs: that would drop the keyboard focus the button holds.
              aria-disabled={busy !== null || undefined}
              aria-busy={busy === format || undefined}
              onClick={() => void download(format, noun)}
            >
              {/* The hidden twin is the longer of the two labels, so the button keeps one width and
                  nothing around it moves when it starts to work. */}
              <span className="report-label">
                <span>{busy === format ? `Preparing ${noun}…` : label}</span>
                <span className="report-label-twin" aria-hidden="true">
                  {`Preparing ${noun}…`}
                </span>
              </span>
            </button>
          ))}
        </div>
        <span className="sr-only" role="status">
          {status}
        </span>
      </div>
      <ReportStyleButton />
      {/* Outside the buttons' box, on a row of its own in the controls row: next to the buttons it would
          push them onto a new row whenever it did not fit, moving the very button that was just pressed. */}
      {error && (
        <div className="report-error-row">
          <span className="report-error" role="alert">
            {error}
          </span>
        </div>
      )}
    </>
  );
}
