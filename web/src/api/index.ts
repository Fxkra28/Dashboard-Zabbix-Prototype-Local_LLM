/**
 * The contract with the BFF as a page sees it: `api`, one method for each endpoint a page reads, and the few functions beside it (sign-in,
 * the live stream, the Assistant's chat, the report file names). Each part of the portal has its calls in a file of its own here, the
 * transport and its deadlines are in `client.ts` and the session is in `session.ts`; this file puts the calls into the one object the pages
 * use, so a page, and a test that replaces `api`, import from `../api` and need not know which file holds a call.
 *
 * `session.ts` does not import this file or the calls: it holds the session and sign-in, and everything else may use it.
 */
import { assistantApi } from './assistant';
import { dashboardApi } from './dashboard';
import { graphsApi } from './graphs';
import { hostsApi } from './hosts';
import { metersApi } from './meters';
import { networkApi } from './network';
import { problemsApi } from './problems';
import { reportsApi } from './reports';
import { shellApi } from './shell';
import { slaApi } from './sla';
import { goToSignIn, isSignedOut, lastKnownUser, userOrRoleChanged } from './session';

export const api = {
  ...shellApi,
  ...hostsApi,
  ...problemsApi,
  ...graphsApi,
  ...networkApi,
  ...metersApi,
  ...dashboardApi,
  ...reportsApi,
  ...slaApi,
  ...assistantApi,
};

export { recordSession, sessionTiming, isSignedOut, AUTH_CHANGED, goToSignIn, renewSession, login, logout, onSessionChange } from './session';
export { withSignal, HttpFailure } from './client';
export { fileNameFrom, reportFileName } from './sla';
export type { AvailabilityQuery, ReportFormat } from './sla';
export type { ExplainSlaQuery } from './assistant';
export { chatStream, chatWarm } from './assistant';
export { streamUrl } from './problems';

// Back can bring a page out of the browser's back/forward cache exactly as it was left, although
// the session may have ended since: after a sign-out in another tab the signed-in page would sit
// behind /login. Check again on the way back. A sign-out goes straight to sign-in; otherwise the
// BFF's 401 does, and another user signed in meanwhile gets the menus redrawn for them.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  if (isSignedOut()) {
    goToSignIn();
    return;
  }
  const was = lastKnownUser();
  void api
    .me()
    .then((m) => {
      if (was && m.user && (m.user.name !== was.name || m.user.role !== was.role)) {
        userOrRoleChanged();
      }
    })
    .catch(() => undefined);
});
