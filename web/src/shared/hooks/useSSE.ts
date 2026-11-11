import { useEffect, useState } from 'react';
import { api } from '../../api';
import { noteMisfit, unreadableMessage, type Guard } from '../../guards';

/** The BFF writes at least every 15 s, a `ping` when nothing else (stream.ts); three missed means the line is dead. */
export const STREAM_SILENT_MS = 45_000;

/** The `ageMs` a keep-alive carries, when it carries one. */
function ageOf(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  try {
    const ms = (JSON.parse(raw) as { ageMs?: unknown }).ageMs;
    return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to one named SSE event; returns the latest payload, when it arrived, connection state,
 * and the last error the stream reported.
 *
 * What it handles, each of which would otherwise fail silently:
 *
 * - The BFF reports a failed Zabbix read as an `event: error` frame; the hook listens for it, so
 *   the badge does not keep saying "Live" over data that has stopped updating.
 * - EventSource cannot see HTTP status, so an expired session would reconnect with the same dead
 *   credential every few seconds, forever. On a dropped connection, one call to /api/auth/me
 *   settles it: `request()` turns a 401 into a sign-out.
 * - A reply that is not an event stream (nginx's 502 while the BFF restarts) makes EventSource give
 *   up for good, so a closed stream reopens on its own, backing off from 2 s to 60 s.
 * - A connection can stay open and go quiet. With `silentMs`, no frame for that long counts as a
 *   drop: the stream is closed, reported as not connected (so the page polls), and reopened.
 * - The BFF does not resend a list that has not changed. The keep-alive carries the list's age, so
 *   `updatedAt` keeps moving on a quiet estate instead of the page calling a steady line "no new
 *   data".
 *
 * A hidden tab has no use for live frames, so the stream closes while the tab is hidden and reopens
 * on return. `connected` keeps its last value meanwhile: the page should not fall back to polling
 * just because it is in the background.
 *
 * With `guard` (a module-level constant: a new one reopens the stream), a frame that parses but is
 * not the shape the page relies on is not shown: it is reported like an error frame, so the page
 * polls until a good frame arrives.
 */
export function useSSE<T>(url: string, event: string, silentMs?: number, guard?: Guard<T>) {
  const [data, setData] = useState<T | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let checkingAuth = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    /** A list is held and no error or drop has followed it: a keep-alive may age it. */
    let haveList = false;

    // Jittered so a room of wall screens does not reconnect in step.
    const reopenLater = () => {
      if (retry || document.visibilityState === 'hidden') return;
      const ceiling = Math.min(60_000, 2_000 * 2 ** attempt++);
      retry = setTimeout(() => {
        retry = null;
        if (!es) open();
      }, ceiling / 2 + Math.random() * (ceiling / 2));
    };

    // Re-armed by every frame, error frames included: they prove the line is alive.
    const watch = (source: EventSource) => {
      if (!silentMs) return;
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (es !== source) return;
        source.close();
        es = null;
        haveList = false;
        setConnected(false);
        reopenLater();
      }, silentMs);
    };

    const open = () => {
      // A browser that has no EventSource is never connected, and the page polls.
      if (typeof EventSource === 'undefined') return;
      const source = new EventSource(url);
      es = source;
      haveList = false; // this connection has not sent one yet

      // Connected means a frame arrived, not that headers did: a proxy can
      // answer 200 and then send nothing, and that is not a live stream.
      source.onopen = () => watch(source);

      // The BFF's keep-alive, every 15 s of otherwise quiet: the line is up
      // even while a slow Zabbix read holds the next frame back. It says how old
      // the list is, so an unchanged one still counts as current.
      source.addEventListener('ping', (e) => {
        watch(source);
        const age = haveList ? ageOf((e as MessageEvent).data) : null;
        if (age !== null) setUpdatedAt((prev) => Math.max(prev ?? 0, Date.now() - age));
      });

      // Both a server-sent `event: error` frame and a dropped connection arrive
      // here. Only the frame carries data.
      source.onerror = (e) => {
        const raw = (e as MessageEvent).data;
        setConnected(false);
        haveList = false;
        if (typeof raw === 'string') {
          watch(source);
          try {
            setError((JSON.parse(raw) as { message?: string }).message ?? 'The live stream reported an error.');
          } catch {
            setError('The live stream reported an error.');
          }
          return;
        }
        // The page cannot see the httpOnly cookie, so it asks; with auth off
        // the answer is always yes.
        if (!checkingAuth) {
          checkingAuth = true;
          void api
            .me()
            .catch(() => undefined)
            .finally(() => {
              checkingAuth = false;
            });
        }
        // CONNECTING means the browser is already retrying; CLOSED means it gave up.
        if (source.readyState === EventSource.CLOSED) {
          if (es === source) es = null;
          reopenLater();
        }
      };

      source.addEventListener(event, (e) => {
        try {
          const frame: unknown = JSON.parse((e as MessageEvent).data);
          const misfit = guard?.misfit(frame) ?? null;
          if (guard && misfit !== null) {
            // The line is alive (so it is watched), but what it carried cannot be shown.
            noteMisfit(`the ${event} frame of ${url}`, misfit);
            watch(source);
            haveList = false;
            setConnected(false);
            setError(unreadableMessage(guard.what));
            return;
          }
          setData(frame as T);
          watch(source);
          attempt = 0;
          haveList = true;
          setUpdatedAt(Date.now());
          setConnected(true);
          setError(null);
        } catch {
          /* ignore malformed frame */
        }
      });
    };

    const close = () => {
      if (retry) clearTimeout(retry);
      if (quiet) clearTimeout(quiet);
      retry = null;
      quiet = null;
      es?.close();
      es = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close();
      else if (!es) open();
    };

    if (document.visibilityState !== 'hidden') open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
    };
  }, [url, event, silentMs, guard]);

  return { data, updatedAt, connected, error };
}
