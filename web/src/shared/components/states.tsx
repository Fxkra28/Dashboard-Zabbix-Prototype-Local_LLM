import type { ReactNode } from 'react';
import { useAuth, roleAllows } from '../hooks/useAuth';
import { staleCopyOf, staleWhen } from '../lib/freshness';
import { formatClockLabeled } from '../lib/time';
import { useReportTimeZone } from '../hooks/useReportTimeZone';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" />
      <div className="state-label">{label}</div>
    </div>
  );
}

/**
 * What to check, when the message says. A Zabbix failure arrives as the BFF's one sentence with a reference to find in its log; a JSON-RPC error names a
 * bad request; a fetch that never reached the BFF, or a proxy with nothing behind it, means the BFF itself. Setting names are for the portal admin only.
 */
function hintFor(message: string, admin: boolean): string | null {
  // The sentence already tells everyone else to ask an administrator, so only the admin gets a line.
  if (/data source is not answering/i.test(message)) {
    return admin
      ? 'Check that ZBX_URL and ZABBIX_API_TOKEN are set on the BFF and that Zabbix is reachable. The BFF log holds the cause under that reference.'
      : null;
  }
  const zabbix =
    (/zabbix/i.test(message) && !/"code":\s*-?\d/.test(message)) ||
    // Zabbix's web server itself failing: "problem.get: HTTP 502 Bad Gateway"
    /^[a-z]+\.[a-z]+: HTTP \d{3}/i.test(message);
  if (zabbix) {
    return admin
      ? 'Check that ZBX_URL and ZABBIX_API_TOKEN are set on the BFF and that Zabbix is reachable.'
      : 'Cannot reach the monitoring server. Tell the portal admin.';
  }
  // No JSON body at all: the request never reached a working BFF.
  if (/failed to fetch|networkerror|load failed|: HTTP 5\d\d$/i.test(message)) {
    return admin ? 'Check that the BFF is running.' : 'The portal is not answering. Try again, or tell the portal admin.';
  }
  return null;
}

/** The BFF's refusal of a page above the signed-in role (security/auth.ts, security/viewerPolicy.ts). */
const ROLE_REFUSAL = /needs the "(\w+)" role; you are signed in as "(\w+)"/;
const FOR_ROLE: Record<string, string> = { viewer: 'viewers', wall: 'wall screens', operator: 'operators', admin: 'admins' };
const withArticle = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

export function ErrorState({ message }: { message: string }) {
  const { role } = useAuth();
  // A page above the signed-in role has not failed to load, so it is said calmly, as a status.
  const refusal = ROLE_REFUSAL.exec(message);
  if (refusal) {
    const [, needs, has] = refusal;
    return (
      <div className="state" role="status">
        <div className="state-title">This page is for {FOR_ROLE[needs] ?? `the ${needs} role`}</div>
        <div className="state-hint">You are signed in as {withArticle(has)}. Ask the portal admin if you need access.</div>
      </div>
    );
  }
  const hint = hintFor(message, roleAllows(role, 'admin'));
  return (
    <div className="state error" role="alert">
      <div className="state-title">Couldn’t load data</div>
      <div className="mono state-detail">{message}</div>
      {hint && <div className="muted state-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

/** A refresh failed; the last good data stays on screen, and says how old it is. */
export function RefreshFailed({ error, updatedAt }: { error: string; updatedAt?: number | null }) {
  useReportTimeZone();
  return (
    <div className="refresh-failed" role="status" title={error}>
      Refresh failed: showing data from {updatedAt ? formatClockLabeled(updatedAt) : 'earlier'}
      {/* The tooltip is for a mouse; a screen reader gets the cause as text. */}
      <span className="sr-only">. {error}</span>
    </div>
  );
}

/**
 * The BFF could not reach Zabbix and answered with the last copy it kept
 * (X-Data-Stale, see shared/lib/freshness.ts). The page would otherwise pass it off
 * as just updated. A refreshing copy (X-Data-Refreshing) is said calmly: nothing failed.
 */
export function StaleCopy({ asOf, what = 'this', refreshing = false }: { asOf: number | null; what?: string; refreshing?: boolean }) {
  const when = staleWhen(asOf);
  if (refreshing) {
    return (
      <div className="data-age" role="status">
        Data {when || 'from earlier'}; a newer copy is being read from Zabbix.
      </div>
    );
  }
  return (
    <div className="refresh-failed" role="status">
      Zabbix did not answer, so {what} is the last copy the portal kept
      {when && `, ${when}`}.
    </div>
  );
}

/**
 * Loaded content. Dimmed (and not clickable) while it still belongs to the
 * previous selection and the new one loads; topped with a note when a refresh
 * failed. Always the same wrapper, so toggling either keeps the content mounted.
 */
export function Loaded({
  stale = false,
  error,
  updatedAt,
  children,
}: {
  stale?: boolean;
  error?: string | null;
  updatedAt?: number | null;
  children: ReactNode;
}) {
  return (
    <div className={stale ? 'stale' : undefined} aria-busy={stale || undefined}>
      {error && !stale && <RefreshFailed error={error} updatedAt={updatedAt} />}
      {children}
    </div>
  );
}

/**
 * Renders loading / error / empty around loaded data.
 *
 * An error replaces the content only when there is nothing of this selection's
 * to show: a failed poll keeps the last good data (with a note), while a failed
 * load for a new selection does not leave the old one standing in for it.
 */
export function Async<T>({
  loading,
  error,
  data,
  stale = false,
  updatedAt,
  children,
  loadingLabel,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  /** `data` is the previous selection's (useAsync's `stale`): dim it. */
  stale?: boolean;
  /** When `data` arrived (useAsync's `updatedAt`), for the refresh-failed note. */
  updatedAt?: number | null;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (error && (data == null || stale)) return <ErrorState message={error} />;
  if (loading && data == null) return <Loading label={loadingLabel} />;
  if (data == null) return <Empty>No data.</Empty>;
  const copy = staleCopyOf(data);
  return (
    <Loaded stale={stale} error={error} updatedAt={updatedAt}>
      {copy && <StaleCopy asOf={copy.asOf} refreshing={copy.refreshing} />}
      {children(data)}
    </Loaded>
  );
}
