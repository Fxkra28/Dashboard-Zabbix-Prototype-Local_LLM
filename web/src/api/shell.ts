/** The two calls the app shell makes before anything else: what the server says about itself, and who is signed in. */

import type { Health, Me } from '../types';
import { meGuard } from '../guards';
import { request } from './client';
import { recordSession } from './session';

export const shellApi = {
  health: () => request<Health>('/api/health'),
  // Who am I, and what may I see? Drives sidebar filtering. Also how long the
  // session has left, which times its renewal (useSessionRenewal).
  me: () =>
    request<Me>('/api/auth/me', { guard: meGuard }).then((m) => {
      recordSession(m.expiresIn, m.user);
      return m;
    }),
};
